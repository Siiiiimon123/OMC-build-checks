"""Native packaging controls only; never changes the application being packaged."""
import json
import os
from pathlib import Path
import plistlib
import shutil
import stat
import xml.etree.ElementTree as ET


def normalize_install_permissions(app, receipt):
    app, receipt = Path(app), Path(receipt)
    assert app.name == 'OMC-Preview.app' and app.is_dir() and not app.is_symlink()
    assert app.parent.name in ('output', 'pkg-preflight'), 'OWNED_STAGING_ONLY'
    rows = []
    for entry in [app, *app.rglob('*')]:
        mode = os.lstat(entry).st_mode
        if stat.S_ISLNK(mode):
            continue
        if stat.S_ISDIR(mode):
            desired = 0o755
        elif stat.S_ISREG(mode):
            desired = 0o755 if mode & 0o111 else 0o644
        else:
            raise AssertionError('UNEXPECTED_STAGED_ENTRY_TYPE')
        if stat.S_IMODE(mode) != desired:
            rows.append({'path': '.' if entry == app else entry.relative_to(app).as_posix(),
                         'before': oct(stat.S_IMODE(mode)), 'after': oct(desired)})
            os.chmod(entry, desired)
    receipt.write_text(json.dumps({'status': 'NORMALIZED_BEFORE_SIGNING',
        'directories': '0755', 'regularData': '0644', 'executables': '0755',
        'symlinksFollowed': False, 'changes': rows}) + '\n')


def verify_installed_payload(app, installed, inventory, reports):
    reports = Path(reports)
    expected = inventory(app)
    actual = None
    error = None
    try:
        actual = inventory(installed)
    except Exception as exc:
        error = type(exc).__name__ + ': ' + str(exc)
    differences = [name for name in sorted(set(expected) | set(actual or {}))
                   if expected.get(name) != (actual or {}).get(name)]
    samples = []
    for relative in ('', 'Contents', 'Contents/MacOS', 'Contents/Resources',
                     'Contents/Resources/app.asar', 'Contents/_CodeSignature/CodeResources'):
        target = Path(installed) / relative
        try:
            mode = os.lstat(target).st_mode
            samples.append({'path': relative or '.', 'mode': oct(stat.S_IMODE(mode)),
                            'readable': os.access(target, os.R_OK)})
        except OSError as exc:
            samples.append({'path': relative or '.', 'error': type(exc).__name__})
    (reports / 'INSTALLED_PAYLOAD_DIFF.json').write_text(json.dumps({
        'status': 'PASS' if actual is not None and not differences else 'FAIL',
        'inventoryError': error, 'differenceCount': len(differences),
        'differences': [{'path': name, 'expected': expected.get(name),
                         'actual': (actual or {}).get(name)} for name in differences],
        'installedPermissions': samples}) + '\n')
    assert actual is not None and not differences, 'INSTALLED_PAYLOAD_DIFFERS_FROM_TESTED_APP'


def control_components(rows):
    assert isinstance(rows, list) and rows
    for row in rows:
        assert isinstance(row, dict) and isinstance(row.get('RootRelativeBundlePath'), str)
        row['BundleIsRelocatable'] = False
        row['BundleOverwriteAction'] = 'upgrade'
        if row.get('ChildBundles'):
            control_components(row['ChildBundles'])
    return rows


def build_nonrelocatable_pkg(app, work, pkg, run, reports):
    app, work, pkg, reports = map(Path, (app, work, pkg, reports))
    assert app.name == 'OMC-Preview.app' and app.is_dir() and not app.is_symlink()
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    identifier, version = info['CFBundleIdentifier'], info['CFBundleVersion']
    assert identifier == 'com.omc.photo-select' and isinstance(version, str) and version
    packaging = work / 'nonrelocatable-pkg-build'
    assert not packaging.exists()
    packaging.mkdir()
    root = packaging / 'payload-root'
    root.mkdir()
    shutil.copytree(app, root / app.name, copy_function=os.link, symlinks=True)
    components = packaging / 'components.plist'
    run('native-pkgbuild-help', ['/usr/bin/pkgbuild', '--help'], allow_failure=True)
    run('native-productbuild-help', ['/usr/bin/productbuild', '--help'], allow_failure=True)
    run('analyze-native-pkg-components', ['/usr/bin/pkgbuild', '--analyze', '--root', root, components])
    rows = control_components(plistlib.loads(components.read_bytes()))
    assert any(row['RootRelativeBundlePath'] == app.name for row in rows)
    components.write_bytes(plistlib.dumps(rows))
    shutil.copyfile(components, reports / 'NONRELOCATABLE_COMPONENTS.plist')
    component = packaging / 'component.pkg'
    run('build-nonrelocatable-component', ['/usr/bin/pkgbuild', '--root', root,
        '--component-plist', components, '--install-location', '/Applications',
        '--identifier', identifier, '--version', version, component])
    product = packaging / 'requirements.plist'
    minimum_os = info.get('LSMinimumSystemVersion')
    assert isinstance(minimum_os, str) and minimum_os
    product.write_bytes(plistlib.dumps({'os': [minimum_os], 'arch': ['arm64']}))
    distribution = packaging / 'Distribution.xml'
    run('synthesize-native-distribution', ['/usr/bin/productbuild', '--synthesize',
        '--product', product, '--package', component, distribution])
    doc = ET.fromstring(distribution.read_bytes())
    assert not list(doc.iter('relocate')), 'SYNTHESIZED_DISTRIBUTION_RELOCATES'
    assert doc.find('options').get('hostArchitectures') == 'arm64', 'SYNTHESIZED_ARCHITECTURE_CHANGED'
    shutil.copyfile(distribution, reports / 'NONRELOCATABLE_DISTRIBUTION.xml')
    run('build-self-contained-pkg', ['/usr/bin/productbuild', '--distribution', distribution,
        '--package-path', packaging, pkg])
    assert pkg.is_file() and not pkg.is_symlink() and pkg.stat().st_size > 0
    (reports / 'NONRELOCATABLE_PACKAGING.json').write_text(json.dumps({
        'identifier': identifier, 'version': version, 'minimumOS': minimum_os,
        'installLocation': '/Applications', 'relocationEnabled': False,
        'sourceAppRetained': True, 'packageOwnBuildDirectory': str(packaging)}) + '\n')
    # Only this run's regenerable intermediate component is removed, after final PKG exists.
    assert component.parent == packaging and component.name == 'component.pkg' and not component.is_symlink()
    component.unlink()


def verify_expanded_contract(expanded, reports):
    expanded, reports = Path(expanded), Path(reports)
    distributions = list(expanded.glob('Distribution')) + list(expanded.glob('Distribution.xml'))
    assert len(distributions) == 1
    xml = distributions[0].read_bytes()
    (reports / 'ACTUAL_PACKAGED_DISTRIBUTION.xml').write_bytes(xml)
    distribution = ET.fromstring(xml)
    assert not list(distribution.iter('relocate')), 'PACKAGED_DISTRIBUTION_RELOCATES'
    assert distribution.find('options').get('hostArchitectures') == 'arm64', 'PACKAGED_ARCHITECTURE_CHANGED'
    infos = list(expanded.rglob('PackageInfo'))
    assert len(infos) == 1, 'EXPECTED_SINGLE_APPLICATION_COMPONENT'
    raw = infos[0].read_bytes()
    (reports / 'ACTUAL_PACKAGED_PackageInfo.xml').write_bytes(raw)
    info = ET.fromstring(raw)
    assert info.get('install-location') == '/Applications', 'PACKAGED_INSTALL_LOCATION_CHANGED'
    assert info.get('identifier') == 'com.omc.photo-select', 'PACKAGED_IDENTIFIER_CHANGED'
    relocations = list(info.iter('relocate'))
    assert len(relocations) <= 1, 'PACKAGEINFO_MULTIPLE_RELOCATION_SECTIONS'
    assert all(not node.attrib and not list(node) and not (node.text or '').strip()
               for node in relocations), 'PACKAGEINFO_ACTIVE_RELOCATION_RULE'


def patch_pkg_contract(text):
    imports = 'import argparse, difflib, hashlib, importlib.util, json, os, platform, shutil, stat, subprocess, sys, tarfile, time, urllib.request'
    assert text.count(imports) == 1
    text = text.replace(imports, imports + '\nfrom pkg_contract_adapter import build_nonrelocatable_pkg, verify_expanded_contract, normalize_install_permissions, verify_installed_payload', 1)
    signing = "run('ad-hoc-sign-native-app',"
    assert text.count(signing) == 1
    text = text.replace(signing, "normalize_install_permissions(app,reports/'APP_INSTALL_PERMISSIONS.json')\n        " + signing, 1)
    old_check = "assert app_payload_records(app)==app_payload_records(installed),'INSTALLED_PAYLOAD_DIFFERS_FROM_TESTED_APP'"
    assert text.count(old_check) == 1
    text = text.replace(old_check, 'verify_installed_payload(app,installed,app_payload_records,reports)', 1)
    old = "run('build-self-contained-pkg',['/usr/bin/productbuild','--component',app,'/Applications',pkg])"
    assert text.count(old) == 1
    text = text.replace(old, 'build_nonrelocatable_pkg(app,work,pkg,run,reports)', 1)
    marker = "result['pkgPayloadReadback']=verify_pkg_payload(app,expanded,pkg,reports/'PKG_PAYLOAD_READBACK.json');checkpoint()"
    assert text.count(marker) == 1
    return text.replace(marker, 'verify_expanded_contract(expanded,reports)\n        ' + marker, 1)

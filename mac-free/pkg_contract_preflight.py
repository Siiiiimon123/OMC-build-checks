"""Small native packaging check before fetching/building the real product. No install."""
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
from pkg_contract_adapter import build_nonrelocatable_pkg, verify_expanded_contract, normalize_install_permissions


def main():
    assert sys.platform == 'darwin'
    work, reports = map(lambda p: Path(p).resolve(), sys.argv[1:])
    assert not work.exists() and not reports.exists()
    work.mkdir()
    reports.mkdir(parents=True)
    app = work / 'OMC-Preview.app'
    executable = app / 'Contents/MacOS/OMC-Preview'
    executable.parent.mkdir(parents=True)
    executable.write_text('#!/bin/sh\nexit 0\n')
    os.chmod(executable, 0o755)
    (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
        'CFBundleIdentifier': 'com.omc.photo-select', 'CFBundleVersion': '1.0.21-preview.15',
        'CFBundleName': 'OMC-Preview', 'CFBundleExecutable': 'OMC-Preview',
        'CFBundlePackageType': 'APPL', 'LSMinimumSystemVersion': '12.0'}))

    def run(label, command, allow_failure=False):
        with (reports / (label + '.log')).open('wb') as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
        if not allow_failure:
            assert result.returncode == 0, label

    package = work / 'preflight.pkg'
    normalize_install_permissions(app, reports / 'PREFLIGHT_PERMISSIONS.json')
    build_nonrelocatable_pkg(app, work, package, run, reports)
    expanded = work / 'expanded'
    run('expand-preflight', ['/usr/sbin/pkgutil', '--expand-full', package, expanded])
    verify_expanded_contract(expanded, reports)
    (reports / 'RESULT.json').write_text(json.dumps({
        'status': 'PASS_NATIVE_PACKAGING_CONTRACT_ONLY',
        'fixtureOnly': True, 'actualInstallationPerformed': False,
        'realProductQualificationRequired': True}) + '\n')


if __name__ == '__main__':
    main()

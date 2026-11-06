"""Current-source native build; only run inside the approved disposable Mac VM.

Reuses the existing fixed wheel/model manifests and the project's native PKG
adapter. Does not claim Developer ID, notarization or in-app upgrade acceptance.
"""
from pathlib import Path, PurePosixPath
from concurrent.futures import ThreadPoolExecutor
import argparse
import datetime
import difflib
import hashlib
import importlib.util
import json
import os
import platform
import plistlib
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.request

BASE_TREE = 'b3c0778f7b8f35e511295bea6f0af02910de840b'
RESOURCE_SHA = '9d75619194c66d1c6bbaeb5d7e63ad4b09b54605f99f7230289ab6f60378cc1a'


def sha(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(file):
    return json.loads(Path(file).read_bytes())


def save(file, value):
    with Path(file).open('x', encoding='utf8') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def safe(root, name):
    p = PurePosixPath(name)
    assert name and not p.is_absolute() and '\\' not in name and ':' not in name
    assert all(part not in ('', '.', '..') for part in name.split('/'))
    target = root.joinpath(*p.parts)
    assert target.resolve().is_relative_to(root.resolve()) and not target.is_symlink()
    return target


def inventory(app):
    rows = {}
    for entry in sorted(app.rglob('*')):
        relative, mode = entry.relative_to(app).as_posix(), os.lstat(entry).st_mode
        if stat.S_ISLNK(mode):
            rows[relative] = {'kind': 'symlink', 'target': os.readlink(entry)}
        elif stat.S_ISREG(mode):
            rows[relative] = {'kind': 'file', 'bytes': entry.stat().st_size,
                              'sha256': sha(entry), 'executeBits': mode & 0o111}
        elif stat.S_ISDIR(mode):
            rows[relative] = {'kind': 'directory'}
        else:
            raise AssertionError('UNEXPECTED_APP_PAYLOAD_TYPE:' + relative)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'records', 'resource-tar', 'inputs', 'work'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('GITHUB_REPOSITORY') == 'Siiiiimon123/OMC-build-checks'
    assert os.environ.get('GITHUB_REF') == 'refs/heads/verify-optimization20'
    assert os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
    assert sys.platform == 'darwin' and platform.machine() == 'arm64'
    assert platform.python_version() == '3.12.10'
    source, records_path, resource_tar, inputs, work = map(lambda p: Path(p).resolve(),
        (args.source, args.records, args.resource_tar, args.inputs, args.work))
    owned = Path(os.environ['RUNNER_TEMP']).resolve()
    assert all(p.is_relative_to(owned) for p in (source, records_path, resource_tar, inputs, work))
    assert not work.exists()
    work.mkdir()
    reports, bundle = work / 'reports', work / 'resources'
    reports.mkdir()
    bundle.mkdir()
    result = {'schema': 'omc-final-native-mac-build-v1', 'status': 'RUNNING',
        'baselineSourceTree': BASE_TREE, 'version': '1.0.21-preview.22',
        'memberReleaseQualified': False, 'fullAiAccepted': False, 'inAppUpgradeAccepted': False,
        'DeveloperIdSigned': False, 'notarized': False, 'GatekeeperFirstDownload': 'UNVERIFIED'}
    env = {k: v for k, v in os.environ.items()
           if k not in ('OMC_PREVIEW15_TRANSPORT_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'ELECTRON_RUN_AS_NODE')}

    def run(label, argv, cwd=None, env=None, allow_failure=False):
        storage_guard('before-' + label)
        print(json.dumps({'phase': label}), flush=True)
        with (reports / (label + '.log')).open('xb') as log:
            p = subprocess.run(list(map(str, argv)), cwd=cwd, env=env or clean_env,
                stdout=log, stderr=subprocess.STDOUT, timeout=1200)
        assert not p.returncode or allow_failure, label + '_FAILED'
        storage_guard('after-' + label)
        return p.returncode

    clean_env = env
    clean_env['npm_config_cache'] = str(work / 'npm-cache')
    clean_env['PIP_NO_CACHE_DIR'] = '1'
    clean_env['PYINSTALLER_CONFIG_DIR'] = str(work / 'pyinstaller-cache')
    clean_env['CSC_IDENTITY_AUTO_DISCOVERY'] = 'false'
    storage_events = []

    def storage_guard(label, extra=0):
        # Count each hardlinked resource once; report conservative logical bytes.
        seen, total = set(), 0
        roots = [work.parent]
        installed_path = Path('/Applications/OMC-Preview.app')
        if installed_path.exists():
            roots.append(installed_path)
        for root in roots:
            for file in root.rglob('*'):
                try:
                    item = os.lstat(file)
                except FileNotFoundError:
                    continue  # A completed tool may have retired its own temp file.
                if not stat.S_ISREG(item.st_mode):
                    continue
                identity = (item.st_dev, item.st_ino)
                if identity not in seen:
                    seen.add(identity)
                    total += item.st_size
        available = shutil.disk_usage(work.parent).free
        storage_events.append({'phase': label, 'uniqueFileBytes': total,
            'forecastAdditionalBytes': extra, 'limitBytes': 5 * 1024**3,
            'volumeFreeBytes': available, 'volumeReserveBytes': 512 * 1024**2})
        (reports / 'STORAGE_EVENTS.json').write_text(json.dumps(storage_events, indent=2) + '\n', encoding='utf8')
        assert total + extra <= 5 * 1024**3, 'HOLD_5GIB_WORKING_ARTIFACT_BUDGET'
        assert available >= extra + 512 * 1024**2, 'HOLD_VM_VOLUME_FREE_RESERVE'

    def discard_generated(directory):
        directory = Path(directory)
        if not directory.exists():
            return
        assert not directory.is_symlink() and directory.is_dir()
        assert directory.resolve().is_relative_to(work.parent.resolve())
        assert directory not in (source, work, work.parent, inputs, reports)
        assert not any((source / row['path']).is_relative_to(directory)
                       for row in manifest['records']), 'TRACKED_SOURCE_RETAINED'
        shutil.rmtree(directory)  # This run's reproducible VM output, not history.

    def download(row, dest):
        assert row['url'].startswith('https://')
        dest.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(row['url'], timeout=120) as reader, dest.open('xb') as writer:
            shutil.copyfileobj(reader, writer, 1024 * 1024)
        assert dest.stat().st_size == row['bytes'] and sha(dest) == row['sha256'], dest.name

    def git(argv, data=None):
        git_env = dict(clean_env, GIT_AUTHOR_NAME='OMC cloud build', GIT_COMMITTER_NAME='OMC cloud build',
            GIT_AUTHOR_EMAIL='build@localhost', GIT_COMMITTER_EMAIL='build@localhost')
        return subprocess.check_output(['git', '-c', 'core.autocrlf=false', *argv],
            cwd=source, env=git_env, input=data)

    try:
        manifest = read(records_path)
        assert manifest['sourceTree'] == BASE_TREE and len(manifest['records']) == 946
        for row in manifest['records']:
            file = safe(source, row['path'])
            assert file.stat().st_size == row['bytes'] and sha(file) == row['sha256'], row['path']
            os.chmod(file, int(row['mode'], 8) & 0o777)
        assert not (source / '.git').exists()
        git(['init', '--quiet'])
        paths = ''.join(row['path'] + '\n' for row in manifest['records']).encode()
        blobs = git(['hash-object', '-w', '--no-filters', '--stdin-paths'], paths).decode().splitlines()
        assert blobs == [row['gitBlobSha1'] for row in manifest['records']]
        baseline_index = ''.join(row['mode'] + ' ' + row['gitBlobSha1'] + '\t' + row['path'] + '\n'
                                 for row in manifest['records']).encode()
        git(['read-tree', '--empty'])
        git(['update-index', '--index-info'], baseline_index)
        assert git(['write-tree']).decode().strip() == BASE_TREE
        # This is the only platform source derivation, explicitly recorded.
        metadata = source / 'public/release-metadata.json'
        before_metadata = sha(metadata)
        release = read(metadata)
        release['releaseCapabilities'].update(releaseProfileId='MAC_ARM64_PREVIEW_WARNING_ONLY',
                                              platform='darwin', arch='arm64')
        metadata.write_text(json.dumps(release, indent=2) + '\n', encoding='utf8')
        actual_rows = []
        for row, blob in zip(manifest['records'], blobs):
            file = safe(source, row['path'])
            if row['path'] == 'public/release-metadata.json':
                blob = git(['hash-object', '-w', '--no-filters', row['path']]).decode().strip()
            actual_rows.append({**row, 'gitBlobSha1': blob, 'bytes': file.stat().st_size, 'sha256': sha(file)})
        git(['read-tree', '--empty'])
        git(['update-index', '--index-info'], ''.join(row['mode'] + ' ' + row['gitBlobSha1'] + '\t' + row['path'] + '\n'
            for row in actual_rows).encode())
        actual_tree = git(['write-tree']).decode().strip()
        commit = git(['commit-tree', actual_tree, '-m', 'Actual Mac22 platform source derivation']).decode().strip()
        git(['update-ref', 'refs/heads/native-input-source', commit])
        git(['symbolic-ref', 'HEAD', 'refs/heads/native-input-source'])
        effective = {'sourceTree': actual_tree, 'records': actual_rows}
        effective_path = reports / 'ACTUAL_MAC_SOURCE.json'
        save(effective_path, effective)
        save(reports / 'SOURCE_DERIVATION.json', {'baselineTree': BASE_TREE, 'derivedTree': actual_tree,
            'sourceCommit': commit, 'changes': [{'path': 'public/release-metadata.json',
                'beforeSha256': before_metadata, 'afterSha256': sha(metadata)}]})
        tools = source / 'build-support/mac/scripts'
        spec = importlib.util.spec_from_file_location('current_mac_inputs', tools / 'mac_inputs.py')
        current_inputs = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(current_inputs)
        source_proof = current_inputs.verify_final_source(source, effective,
            {'sourceTree': actual_tree, 'sourceCommit': commit})
        assert sha(resource_tar) == RESOURCE_SHA
        with tarfile.open(resource_tar, 'r:') as archive:
            original = json.load(archive.extractfile('BUNDLE-MANIFEST.json'))
            declared = {row['path']: row for row in original['files']}
            assert len(declared) == len(original['files'])
            needed = {row['path'] for row in original['resources']} | {
                'metadata/python-wheels.lock.json', 'metadata/requirements-macos.full.lock.txt',
                'metadata/toolchain-assets.json'}
            for name in sorted(needed):
                row, member = declared[name], archive.getmember(name)
                assert member.isfile() and not member.issym() and not member.islnk()
                assert member.size == row['bytes']
                dest = safe(bundle, name)
                dest.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as reader, dest.open('xb') as writer:
                    shutil.copyfileobj(reader, writer, 1024 * 1024)
                assert sha(dest) == row['sha256']
        storage_guard('verified-resource-extraction')
        assert resource_tar.is_file() and sha(resource_tar) == RESOURCE_SHA
        resource_tar.unlink()  # Exact authenticated transport; original remote kept.
        wheels = read(bundle / 'metadata/python-wheels.lock.json')['records']
        assert len(wheels) == 48
        wheelhouse = bundle / 'wheelhouse'
        wheelhouse.mkdir()
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda row: download(row, wheelhouse / row['filename']), wheels))
        wheel_lock = wheelhouse / 'requirements-macos.full.lock.txt'
        shutil.copyfile(bundle / 'metadata/requirements-macos.full.lock.txt', wheel_lock)
        venv = work / 'venv'
        run('create-build-venv', [sys.executable, '-m', 'venv', venv])
        python = venv / 'bin/python'
        run('install-fixed-wheels', [python, '-m', 'pip', 'install', '--no-index', '--find-links',
            wheelhouse, '--require-hashes', '-r', wheel_lock])
        run('npm-ci-fixed-source', ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], source)
        # Recover only the approved face assets before Vite, not the large AI models.
        face = read(source / 'contracts/frontend-face-runtime-v1.json')
        for row in face['assets']:
            dest = safe(source, row['path'])
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.suffix == '.task':
                download({'url': 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
                    'bytes': row['sizeBytes'], 'sha256': row['sha256']}, dest)
            else:
                origin = source / 'node_modules/@mediapipe/tasks-vision/wasm' / dest.name
                assert origin.stat().st_size == row['sizeBytes'] and sha(origin) == row['sha256']
                shutil.copyfile(origin, dest)
        run('stage-existing-subject-model', ['node', Path(__file__).with_name('provision-subject-model.cjs'),
            source, reports], source)
        run('vite-current-source', ['npm', 'run', 'build'], source)
        for row in original['resources']:
            origin, dest = safe(bundle, row['path']), safe(source, row['target'])
            assert origin.stat().st_size == row['bytes'] and sha(origin) == row['sha256']
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                assert sha(dest) == row['sha256']
            else:
                os.link(origin, dest)
        execution = {'schema': 'omc-current-mac-native-inputs-v1', **source_proof,
            'baselineSourceTree': BASE_TREE,
            'resources': [{k: row[k] for k in ('target', 'bytes', 'sha256')} for row in original['resources']]}
        save(bundle / 'bundle-manifest.json', execution)
        generated = {'schema': 'omc-mac-private-runtime-inputs-v1', 'status': 'VERIFIED_APPROVED_INPUTS',
            'target': 'macos-arm64', 'target_contract': current_inputs.TARGET, **source_proof,
            'sourceManifestSHA256': sha(effective_path), 'bundleManifestSHA256': sha(bundle / 'bundle-manifest.json'),
            'resources': execution['resources'], 'wheelFiles': [{'path': 'wheelhouse/' + row['filename'],
                'bytes': row['bytes'], 'sha256': row['sha256']} for row in wheels],
            'formalReleaseApproval': False, 'inputAcquisition': 'existing exact resources and fixed official wheels'}
        save(source / 'ai-training/mac-private-runtime-inputs.json', generated)
        save(reports / 'ACTUAL_INPUT_BINDING.json', generated)
        derived_tools = work / 'derived-build-tools'
        shutil.copytree(tools, derived_tools)
        runtime_spec = derived_tools / 'mac-runtime.spec'
        before = runtime_spec.read_bytes()
        old = b"Analysis(['scripts/inference_server_onnx.py'],"
        new = b"Analysis([str(ai/'scripts/inference_server_onnx.py')],"
        assert before.count(old) == 1 and new not in before
        runtime_spec.write_bytes(before.replace(old, new))
        save(reports / 'BUILD_TOOL_ADAPTER.json', {'sourceTree': actual_tree,
            'originSpecSHA256': hashlib.sha256(before).hexdigest(), 'derivedSpecSHA256': sha(runtime_spec),
            'builderUnchanged': sha(derived_tools / 'build_ai_service_macos.py') == sha(tools / 'build_ai_service_macos.py'),
            'diff': ''.join(difflib.unified_diff(before.decode().splitlines(True), runtime_spec.read_text().splitlines(True)))})
        build_env = dict(clean_env, OMC_MAC_BUNDLE=str(bundle))
        storage_guard('forecast-native-runtime-collection',
            sum(row['bytes'] for row in original['resources']) + 768 * 1024**2)
        run('build-current-native-ai', [python, derived_tools / 'build_ai_service_macos.py',
            source / 'ai-training', bundle], env=build_env)
        # The runtime now owns verified copies. Release only this job's redundant
        # model staging, and retain all source/code and provenance records.
        tracked = {row['path'] for row in manifest['records']}
        native_runtime = source / 'ai-training/dist/ai-service/_internal'
        for row in original['resources']:
            parts = PurePosixPath(row['target']).parts
            relative = (Path('models').joinpath(*parts[2:]) if parts[:2] == ('public', 'models')
                        else Path(*parts[1:]) if parts[0] == 'ai-training' else None)
            if relative is None:
                continue  # Non-runtime assets can still be needed by app packaging.
            assert sha(native_runtime / relative) == row['sha256']
            staged = safe(source, row['target'])
            if row['target'] not in tracked:
                assert sha(staged) == row['sha256']
                staged.unlink()
            original_resource = safe(bundle, row['path'])
            assert sha(original_resource) == row['sha256']
            original_resource.unlink()
        discard_generated(wheelhouse)
        discard_generated(venv)
        discard_generated(source / 'ai-training/build')
        discard_generated(work / 'pyinstaller-cache')
        discard_generated(work / 'npm-cache')
        storage_guard('native-runtime-staging-reclaimed')
        electron = read(bundle / 'metadata/toolchain-assets.json')['electron']['asset']
        electron_zip = bundle / electron['filename']
        download({'url': electron['url'], 'bytes': electron['bytes'],
            'sha256': electron['sha256FromOfficialShasums']}, electron_zip)
        electron_dist = source / 'node_modules/electron/dist'
        electron_dist.mkdir()
        run('extract-fixed-electron', ['/usr/bin/ditto', '-x', '-k', electron_zip, electron_dist])
        (source / 'node_modules/electron/path.txt').write_text('Electron.app/Contents/MacOS/Electron', encoding='utf8')
        derived_builder = work / 'mac-builder-move-runtime.cjs'
        derived_builder.write_text('const c=require(' + json.dumps(str(source / 'build-support/mac/mac-builder.cjs'))
            + ');module.exports={...c,extraResources:c.extraResources.filter(r=>r.to!=="ai-service")};\n', encoding='utf8')
        run('package-current-app', [source / 'node_modules/.bin/electron-builder', '--mac', 'dir',
            '--arm64', '--config', derived_builder], source)
        output = work / 'output'
        output.mkdir()
        app = output / 'OMC-Preview.app'
        shutil.move(source / 'mac-preview-output/build/mac-arm64/OMC-Preview.app', app)
        runtime_source = source / 'ai-training/dist/ai-service'
        before_runtime = inventory(runtime_source)
        shutil.move(runtime_source, app / 'Contents/Resources/ai-service')
        assert inventory(app / 'Contents/Resources/ai-service') == before_runtime
        save(reports / 'SINGLE_RUNTIME_MOVE.json', {'status': 'PASS', 'files': len(before_runtime),
            'wholeRuntimeCopied': False, 'runtimeRebuiltFromCurrentSource': True})
        default = app / 'Contents/Resources/default_app.asar'
        if default.exists():
            assert default.is_file() and not default.is_symlink()
            save(reports / 'REMOVED_DEFAULT_ENTRY.json', {'bytes': default.stat().st_size, 'sha256': sha(default)})
            default.unlink()
        assert not (app / 'Contents/Resources/app').exists()
        plist = app / 'Contents/Info.plist'
        info = plistlib.loads(plist.read_bytes())
        assert info['CFBundleIdentifier'] == 'com.omc.photo-select'
        info['CFBundleShortVersionString'] = '1.0.21-preview.22'
        info['CFBundleVersion'] = '1.0.21.22'
        run('read-current-asar-header', ['node', Path(__file__).with_name('read-asar-header.cjs'),
            source, app / 'Contents/Resources/app.asar', reports / 'ASAR_HEADER.json'])
        header = read(reports / 'ASAR_HEADER.json')
        info.setdefault('ElectronAsarIntegrity', {})['Resources/app.asar'] = {
            'algorithm': 'SHA256', 'hash': header['sha256']}
        info['ElectronAsarIntegrity'].pop('Resources/default_app.asar', None)
        plist.write_bytes(plistlib.dumps(info))
        electron_zip.unlink()
        discard_generated(electron_dist)
        storage_guard('single-current-app-assembled')
        sys.path.insert(0, str(inputs))
        from pkg_contract_adapter import (normalize_install_permissions, build_nonrelocatable_pkg,
            verify_expanded_contract, verify_installed_payload)
        normalize_install_permissions(app, reports / 'APP_INSTALL_PERMISSIONS.json')
        run('ad-hoc-sign-native-app', ['/usr/bin/codesign', '--force', '--deep', '--sign', '-', app])
        run('bind-final-native-contract', [sys.executable, tools / 'finalize_mac_contract.py', app])
        run('seal-outer-app-only', ['/usr/bin/codesign', '--force', '--sign', '-', app])
        run('audit-final-native-app', [sys.executable, tools / 'audit_mac_app.py', app, reports / 'ARCHITECTURE_AUDIT.json'])
        run('attest-current-self-contained-raw-runtime', [app / 'Contents/Resources/ai-service/ai-service', '--mac-runtime-attestation'])
        run('verify-current-app-entry', ['node', Path(__file__).with_name('verify-mac-entry.cjs'),
            source, app, sha(app / 'Contents/Resources/app.asar'), reports / 'PREPACKAGE_ENTRY.json'])
        package = output / 'OMC-Preview-1.0.21-preview.22-mac-arm64-unsigned.pkg'
        build_nonrelocatable_pkg(app, work, package, run, reports)
        app_bytes = sum(v['bytes'] for v in inventory(app).values() if v['kind'] == 'file')
        storage_guard('before-pkg-payload-readback', app_bytes)
        expanded = work / 'pkg-expanded-for-readback'
        run('expand-built-pkg', ['/usr/sbin/pkgutil', '--expand-full', package, expanded])
        verify_expanded_contract(expanded, reports)
        expanded_apps = [p for p in expanded.rglob(app.name) if p.is_dir() and not p.is_symlink()]
        assert len(expanded_apps) == 1 and expanded_apps[0].resolve().is_relative_to(expanded)
        assert inventory(app) == inventory(expanded_apps[0]), 'PKG_BYTES_OR_MODES_DIFFER'
        save(reports / 'PKG_PAYLOAD_READBACK.json', {'status': 'PASS', 'sha256': sha(package)})
        shutil.rmtree(expanded)  # Owned ephemeral readback only; no historical records.
        installed = Path('/Applications/OMC-Preview.app')
        assert not installed.exists() and not installed.is_symlink()
        storage_guard('before-first-install', app_bytes)
        run('install-built-pkg', ['sudo', '-n', '/usr/sbin/installer', '-pkg', package, '-target', '/'])
        verify_installed_payload(app, installed, inventory, reports)
        assert inventory(app) == inventory(installed)
        discard_generated(app)  # Installed exact keeper verified; keep one work app.
        storage_guard('verified-installed-keeper')
        run('installed-normal-main-smoke', ['node', tools / 'normal_entry_smoke.mjs', installed,
            reports / 'installed-normal-entry'])
        current_inputs.verify_final_source(source, effective, {'sourceTree': actual_tree, 'sourceCommit': commit})
        result.update(status='PASS_NATIVE_BUILD_AND_FIRST_INSTALL_PENDING_AI_UPGRADE',
            derivedSourceTree=actual_tree, sourceCommit=commit, installedApp=str(installed),
            package={'path': str(package), 'bytes': package.stat().st_size, 'sha256': sha(package)})
    except Exception as exc:
        result.update(status='FAIL', error=type(exc).__name__ + ': ' + str(exc))
        raise
    finally:
        save(reports / 'BUILD_RESULT.json', result)


if __name__ == '__main__':
    main()

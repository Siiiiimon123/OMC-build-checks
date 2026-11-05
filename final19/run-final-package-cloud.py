"""Bounded final build/install controller. No live update or DNS publication.

All plaintext source, photos, model/runtime and evidence remain in the VM;
only authenticated ciphertext outputs may leave the runner.
"""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import traceback
import zipfile
import ast
import time

HERE = Path(__file__).resolve().parent
WORK = Path(os.environ['RUNNER_TEMP']).resolve() / 'omc-final-package19'
SOURCE_TREE = '1e39b9ae2921480b27d4a1a8bf5f8499004886fa'


def sha(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(file, value):
    file.write_text(json.dumps(value, indent=2) + '\n', encoding='utf8')


def safe(root, name):
    p = PurePosixPath(name)
    assert name and not p.is_absolute() and '\\' not in name and ':' not in name
    assert all(s not in ('', '.', '..') for s in name.split('/'))
    return root.joinpath(*p.parts)


def unzip(archive, root, records=None, limit=16 * 1024**2):
    with zipfile.ZipFile(archive) as z:
        info = z.infolist()
        assert len({i.filename.lower() for i in info}) == len(info)
        assert sum(i.file_size for i in info) <= limit
        by = {r['path']: r for r in records} if records else None
        if by:
            assert {i.filename for i in info} == set(by)
        root.mkdir()
        for row in info:
            assert not row.is_dir() and (row.external_attr >> 16) & 0o170000 != 0o120000
            target = safe(root, row.filename)
            data = z.read(row)
            if by:
                assert len(data) == by[row.filename]['bytes']
                assert hashlib.sha256(data).hexdigest() == by[row.filename]['sha256']
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)


def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('GITHUB_REPOSITORY') == 'Siiiiimon123/OMC-build-checks'
    assert os.environ.get('GITHUB_REF') == 'refs/heads/verify-final-package19'
    assert os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
    assert sys.platform in ('win32', 'darwin') and not WORK.exists()
    assert shutil.disk_usage(WORK.parent).free > 14 * 1024**3
    WORK.mkdir()
    evidence, encrypted = WORK / 'evidence', WORK / 'encrypted'
    evidence.mkdir()
    encrypted.mkdir()
    result = {'schema': 'omc-final-package-cloud-v1', 'status': 'RUNNING',
        'baselineSourceTree': SOURCE_TREE, 'memberReleaseAccepted': False,
        'productionInAppUpgrade': 'NOT_RUN_REQUIRES_UNBLOCKED_TRUSTED_FEED',
        'dnsOrFeedModified': False, 'feeUSD': 0}
    private_env = dict(os.environ)
    clean_env = {k: v for k, v in private_env.items()
                 if k not in ('OMC_PREVIEW15_TRANSPORT_KEY', 'GITHUB_TOKEN', 'GH_TOKEN')
                 and k.lower() != 'psmodulepath'}

    def run(label, argv, cwd=None, timeout=1200, private=False):
        print(json.dumps({'phase': label}), flush=True)
        with (evidence / (label + '.log')).open('xb') as log:
            p = subprocess.run(list(map(str, argv)), cwd=cwd,
                env=private_env if private else clean_env,
                stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
        assert p.returncode == 0, label + '_FAILED'

    transport = HERE / 'transport.cjs'
    def fetch_exact(label, manifest, asset_id, output):
        # Retry only a read of the same authenticated bytes, never an entire
        # build/test job. Every failed attempt retains its own private log.
        failures = []
        for attempt in range(1, 4):
            try:
                run(label + '-attempt-' + str(attempt), ['node', transport, 'fetch',
                    '--manifest', manifest, '--id', asset_id, '--output', output],
                    timeout=600, private=True)
                save(evidence / (label + '-attempts.json'), {'attempts': attempt,
                    'priorFailures': failures, 'exactAsset': asset_id, 'status': 'PASS'})
                return
            except (AssertionError, subprocess.TimeoutExpired) as exc:
                failures.append({'attempt': attempt, 'error': type(exc).__name__})
                assert not output.exists(), 'UNEXPECTED_COMMITTED_OUTPUT_AFTER_FAILED_FETCH'
                for temporary in output.parent.glob(output.name + '.*.part'):
                    assert temporary.is_file() and not temporary.is_symlink()
                    temporary.unlink()  # Only this attempt's reproducible VM download.
                save(evidence / (label + '-attempts.json'), {'attempts': attempt,
                    'priorFailures': failures, 'exactAsset': asset_id, 'status': 'RETRY_PENDING' if attempt < 3 else 'FAIL'})
                if attempt == 3:
                    raise
                time.sleep(3 if attempt == 1 else 7)
    package = None
    success = False
    try:
        scope = json.loads((HERE / 'EXECUTION_SCOPE.json').read_bytes())
        assert scope['schema'] == 'omc-final-package19-bounded-execution-v1'
        assert scope['cloudDispatchApproved'] is True and scope['feeUSD'] == 0
        assert scope['baselineSourceTree'] == SOURCE_TREE and scope['automaticRerun'] is False
        assert scope['limits']['windowsMaxRuns'] <= 3 and scope['limits']['macMaxRuns'] <= 3
        assert scope['limits']['minutesEach'] <= 90
        # Reuse the already authorized encrypted source and exactly two photos.
        prior = HERE.parent / 'jpeg19-source'
        cfg = json.loads((prior / 'INPUT.json').read_bytes())
        for asset in cfg['assets']:
            target, meta = WORK / (asset['id'] + '.enc'), WORK / (asset['id'] + '.transport.json')
            parts = sorted((prior / 'inputs' / asset['id']).glob('*.enc'))
            assert len(parts) == (asset['ciphertextBytes'] + 65535) // 65536
            with target.open('xb') as writer:
                for i, part in enumerate(parts):
                    assert part.name == str(i).zfill(4) + '.enc'
                    writer.write(part.read_bytes())
            assert target.stat().st_size == asset['ciphertextBytes']
            assert sha(target) == asset['ciphertextSha256']
            save(meta, {'schema': 'omc-aes256gcm-build-transport-v1', 'assets': [asset]})
            dest = WORK / (asset['id'] + ('.jpg' if asset['id'].startswith('sample-') else '.plain'))
            run('decrypt-' + asset['id'], ['node', transport, 'decrypt', '--manifest', meta,
                '--id', asset['id'], '--input', target, '--output', dest], timeout=120, private=True)
        records = json.loads((WORK / 'source19-records.plain').read_bytes())
        assert records['sourceTree'] == SOURCE_TREE and len(records['records']) == 932
        source = WORK / 'source'
        unzip(WORK / 'source19.plain', source, records['records'])
        inputs = WORK / 'inputs'
        run('decrypt-final-helper-input', ['node', transport, 'decrypt', '--manifest', HERE / 'FINAL_HELPERS.transport.json',
            '--id', 'final-helpers', '--input', HERE / 'final-helpers.enc', '--output', WORK / 'final-helpers.zip'],
            timeout=120, private=True)
        unzip(WORK / 'final-helpers.zip', inputs, limit=2 * 1024**2)
        shutil.copyfile(WORK / 'source19-records.plain', inputs / 'source19-records.json')
        if sys.platform == 'win32':
            # Parse the actual decrypted PowerShell files before large downloads.
            # Windows PowerShell must construct its own compatible module path,
            # rather than inheriting the runner's PowerShell7-only locations.
            ps = "$ErrorActionPreference='Stop';Get-Command Get-FileHash,Get-CimInstance,Start-Process,ConvertFrom-Json -ErrorAction Stop|Out-Null;"
            for file in inputs.glob('*.ps1'):
                literal = str(file).replace("'", "''")
                ps += "$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('" + literal + "',[ref]$t,[ref]$e);if($e.Count){throw ($e|Out-String)};"
            run('parse-native-install-helpers', ['powershell.exe', '-NoProfile', '-Command', ps], timeout=60)
        acceptance_only = os.environ.get('OMC_ACCEPT_EXISTING_WINDOWS') == '1'
        if acceptance_only:
            assert sys.platform == 'win32'
            run('retrieve-frozen-windows-artifact', ['node', HERE / 'fetch-frozen-windows19.mjs',
                WORK / 'frozen-package.zip'], timeout=600, private=True)
            cipher = WORK / 'frozen-cipher'
            cipher.mkdir()
            with zipfile.ZipFile(WORK / 'frozen-package.zip') as z:
                assert set(z.namelist()) == {'package.enc', 'PACKAGE_READY.json'}
                for row in z.infolist():
                    assert not row.is_dir() and row.file_size <= 804 * 1024**2
                    with z.open(row) as reader, (cipher / row.filename).open('xb') as writer:
                        shutil.copyfileobj(reader, writer, 1024**2)
            package_inputs = inputs / 'PACKAGE_INPUTS.json'
            current_record = json.loads(package_inputs.read_bytes())
            current = current_record['current']
            assert current_record['baselineSourceTree'] == SOURCE_TREE
            assert current['bytes'] == 803348413
            assert current['sha256'] == 'daade4392f5b77262fbd1f53b4ffbcb89e73290952f1a0779739c0ff8d97eb27'
            package = WORK / Path(current['path']).name
            run('decrypt-exact-frozen-windows', ['node', transport, 'decrypt', '--manifest',
                cipher / 'PACKAGE_READY.json', '--id', 'pkg', '--input', cipher / 'package.enc',
                '--output', package], timeout=600, private=True)
            assert package.stat().st_size == current['bytes'] and sha(package) == current['sha256']
            current['path'] = str(package)
            save(package_inputs, current_record)
            result['acceptanceOnlyFrozenArtifact'] = 13402959173
            result['productRebuilt'] = False
            run('npm-ci-fixed-source', ['npm.cmd', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], source)
            run('first-install-windows', ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                '-File', inputs / 'Install-FinalWindows.ps1', '-InputsPath', package_inputs,
                '-OutputPath', evidence / 'FIRST_INSTALL.json'], timeout=600)
            installation = json.loads((evidence / 'FIRST_INSTALL.json').read_text(encoding='utf-8-sig'))
            assert installation['installedPayloadPassed'] is True
            installed = installation['executable']
            result['firstInstallPayloadPassed'] = True
            result['shortcutBindingPassed'] = installation['shortcutBindingPassed']
        elif sys.platform == 'win32':
            # A new build alone requires model transport; acceptance reuses the frozen installer.
            fetch_exact('fetch-existing-model-transport', HERE / 'RESOURCE_TRANSPORT.json', 'base', WORK / 'base.tar')
            assert platform.python_version() == '3.14.5'
            fetch_exact('fetch-existing-windows18', HERE / 'WIN18_BASE_OUTPUTS.json', 'pkg', WORK / 'win18.exe')
            run('npm-ci-fixed-source', ['npm.cmd', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], source)
            venv = WORK / 'venv'
            run('create-build-venv', [sys.executable, '-m', 'venv', venv])
            python = venv / 'Scripts/python.exe'
            run('install-fixed-binary-build-wheels', [python, '-m', 'pip', 'install', '--only-binary=:all:', '--no-deps',
                '-r', source / 'ai-training/requirements-ai-service.lock.txt'])
            run('build-final-windows', ['node', HERE / 'cloud-final-windows-build.cjs', '--source', source,
                '--base', WORK / 'win18.exe', '--work', WORK / 'build', '--inputs', inputs,
                '--resources', WORK / 'base.tar', '--python', python], timeout=2400)
            package_inputs = WORK / 'build/reports/PACKAGE_INPUTS.json'
            current = json.loads(package_inputs.read_bytes())['current']
            package = Path(current['path'])
            # Disposable CI account only: first canonical installation, no dev PATH.
            run('first-install-windows', ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                '-File', inputs / 'Install-FinalWindows.ps1', '-InputsPath', package_inputs,
                '-OutputPath', evidence / 'FIRST_INSTALL.json'], timeout=600)
            installed = json.loads((evidence / 'FIRST_INSTALL.json').read_bytes())['executable']
        else:
            fetch_exact('fetch-existing-model-transport', HERE / 'RESOURCE_TRANSPORT.json', 'base', WORK / 'base.tar')
            assert platform.python_version() == '3.12.10'
            run('build-install-final-mac', [sys.executable, HERE / 'cloud-final-mac-build.py',
                '--source', source, '--records', WORK / 'source19-records.plain', '--resource-tar', WORK / 'base.tar',
                '--inputs', inputs, '--work', WORK / 'build'], timeout=3000)
            built = json.loads((WORK / 'build/reports/BUILD_RESULT.json').read_bytes())
            package = Path(built['package']['path'])
            plist = Path(built['installedApp']) / 'Contents/Info.plist'
            import plistlib
            executable = plistlib.loads(plist.read_bytes())['CFBundleExecutable']
            installed = str(Path(built['installedApp']) / 'Contents/MacOS' / executable)
        # Validate the installed package with the same reviewed real-photo and
        # synthetic-group flow, including full byte-bound AI responses.
        for identity in ('synthetic', 'sample-a', 'sample-b'):
            test = WORK / ('installed-' + identity)
            test.mkdir()
            argv = ['node', HERE / 'cloud-final-installed.mjs', source, test,
                    '' if identity == 'synthetic' else WORK / (identity + '.jpg'), installed]
            run('installed-' + identity, argv, source, timeout=900)
            shutil.copytree(test / 'evidence', evidence / ('installed-' + identity))
        result.update(status='PASS_FINAL_PACKAGE_FIRST_INSTALL_FULL_AI_JPEG_GROUP_EXPORT',
            package={'bytes': package.stat().st_size, 'sha256': sha(package), 'name': package.name},
            firstInstallPassed=True, fullAiFunctionalPassed=True, installedRealJpegPassed=True)
        if acceptance_only and result['shortcutBindingPassed'] is not True:
            result['firstInstallPassed'] = False
            raise AssertionError('WINDOWS_DESKTOP_SHORTCUT_BINDING_NOT_VERIFIED')
        success = True
    except Exception as exc:
        result.update(status='FAIL', error=type(exc).__name__ + ': ' + str(exc))
        (evidence / 'CONTROLLER_ERROR.log').write_text(traceback.format_exc(), encoding='utf8')
    finally:
        if (WORK / 'build/reports').is_dir():
            shutil.copytree(WORK / 'build/reports', evidence / 'build', dirs_exist_ok=True)
        for test in WORK.glob('installed-*'):
            if (test / 'evidence').is_dir():
                shutil.copytree(test / 'evidence', evidence / test.name, dirs_exist_ok=True)
        save(evidence / 'SUMMARY.json', result)
        archive = WORK / 'reports.zip'
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
            for file in sorted(evidence.rglob('*')):
                if file.is_file():
                    z.write(file, file.relative_to(evidence).as_posix())
        run('encrypt-reports', ['node', transport, 'encrypt', '--input', archive,
            '--output', encrypted / 'reports.enc', '--id', 'reports', '--manifest', encrypted / 'REPORTS_READY.json'],
            timeout=600, private=True)
        if package and package.is_file() and os.environ.get('OMC_ACCEPT_EXISTING_WINDOWS') != '1':
            run('encrypt-package', ['node', transport, 'encrypt', '--input', package,
                '--output', encrypted / 'package.enc', '--id', 'pkg', '--manifest', encrypted / 'PACKAGE_READY.json'],
                timeout=600, private=True)
        print(json.dumps({'status': result['status'], 'releaseAccepted': False,
            'productionUpgradeAccepted': False, 'encryptedOutputs': True}), flush=True)
    return 0 if success else 1


if __name__ == '__main__':
    if sys.argv[1:] == ['--preflight']:
        assert os.environ.get('GITHUB_ACTIONS') == 'true'
        for file in HERE.glob('*.py'):
            ast.parse(file.read_text(encoding='utf8'), filename=str(file))
        for name in ('cloud-final-windows-build.cjs', 'cloud-final-installed.mjs',
                     'cloud-final-flow.mjs', 'transport.cjs', 'bootstrap.cjs', 'contracts.cjs'):
            file = HERE / name
            assert file.is_file(), 'WORKFLOW_INPUT_MISSING:' + name
            subprocess.run(['node', '--check', str(file)], check=True, timeout=30)
        print('PASS_ALL_ACTUAL_CONTROLLER_PARSE_CHECKS')
    else:
        assert not sys.argv[1:]
        sys.exit(main())

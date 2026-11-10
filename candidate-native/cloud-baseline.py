"""Verify the published baseline or two staged installers in a disposable runner."""
import hashlib
import http.client
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

WIN = sys.platform == 'win32'
MAC = sys.platform == 'darwin'
APP = Path(os.environ['LOCALAPPDATA']) / 'Programs/OMC-Photo-Select/OMC-Photo-Select.exe' if WIN else Path('/Applications/OMC-Preview.app/Contents/MacOS/OMC-Preview')
SPECS = {
    'win32': ('OMC-Photo-Select-1.0.21-preview.24-x64.exe', 806461267, '4ac3fcd07425bcb32a7356a1abbbdacf9385507711e096acd7830104e7c8079f'),
    'darwin': ('OMC-Preview-1.0.21-preview.24-mac-arm64-unsigned.pkg', 991719638, 'c410173d2ec9088895e6d8d02c6a55785ae5c7e6a30f74ca585ffa05f3281b3b'),
}
ASAR = {
    'win32': '880b57175b2c72dab99e48acbefb385e007c2918a041371df4c7b8ed8a58a373',
    'darwin': 'fef9b673eeca088459d13aeba79a7cec9647ccb2e1225786c3a4298775312a43',
}
LEGACY = {
    'win32': (806457221, '9dc4195d811683ae66c8b3ca452b16e5d47b0b3c045eda339bc01817e0096a3a',
              'c4fca71ae3b2ef548c32b50d741dc9b6d84c875d414e036ef2ac7796a1849998'),
    'darwin': (991713413, '61e4c5a5fa01622bff2f8c3ab4d37136ceda1fdef3ede684eddfea1327cc9ef0',
               'bdf5be0ba8953c901e8774c8bea13dc3a6cd3f0e6da61b6bb65fc89f3ab51d1a'),
}

def download(url, destination, length, sha256):
    digest, read = hashlib.sha256(), 0
    next_progress = 64 * 1024 * 1024
    deadline = time.monotonic() + 45 * 60
    failures = 0
    with destination.open('xb') as out:
        while read < length:
            if time.monotonic() >= deadline:
                raise RuntimeError('Package download deadline exceeded')
            offset = read
            headers = {'Accept-Encoding': 'identity'}
            if offset:
                headers['Range'] = f'bytes={offset}-'
            request = urllib.request.Request(url, headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    if response.geturl() != url or response.status != (206 if offset else 200):
                        raise RuntimeError('Unexpected package route or response status')
                    if offset and response.headers.get('Content-Range') != f'bytes {offset}-{length-1}/{length}':
                        raise RuntimeError('Package resume range does not match')
                    for block in iter(lambda: response.read(1024 * 1024), b''):
                        if time.monotonic() >= deadline or read + len(block) > length:
                            raise RuntimeError('Package download exceeded its time or byte limit')
                        read += len(block)
                        digest.update(block)
                        out.write(block)
                        if read >= next_progress:
                            print(f'Package download: {read}/{length} bytes', flush=True)
                            next_progress += 64 * 1024 * 1024
                    if read < length:
                        raise ConnectionError('Package response ended before all expected bytes')
            except (urllib.error.URLError, ConnectionError, TimeoutError, http.client.IncompleteRead) as error:
                if isinstance(error, urllib.error.HTTPError) and error.code not in (408, 429, 500, 502, 503, 504):
                    raise
                failures += 1
                if failures >= 5 or time.monotonic() >= deadline:
                    raise
                print(f'Package transfer retry {failures}/4 at byte {read}: {type(error).__name__}', flush=True)
                time.sleep(2 ** failures)
    assert read == length and digest.hexdigest() == sha256

def install(installer):
    if WIN:
        executable = installer.resolve()
        # Wait through the NSIS launcher/child boundary.
        env = {key:value for key,value in os.environ.items() if key.lower() != 'psmodulepath'}
        env['OMC_QA_INSTALLER_PATH'] = str(executable)
        command = "$p=Start-Process -FilePath $env:OMC_QA_INSTALLER_PATH -ArgumentList '/S /currentuser' -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode"
        subprocess.run(['powershell.exe','-NoProfile','-Command',command],check=True,timeout=330,env=env)
        return APP
    subprocess.run(['sudo','-n','/usr/sbin/installer','-pkg',installer,'-target','/'],check=True,timeout=330)
    bundle = Path('/Applications/OMC-Preview.app')
    binary = subprocess.check_output(['/usr/libexec/PlistBuddy','-c','Print :CFBundleExecutable',bundle/'Contents/Info.plist'],text=True).strip()
    assert binary and Path(binary).name == binary
    return bundle/'Contents/MacOS'/binary

def jpeg_fixture_codec(work):
    request = urllib.request.Request('https://registry.npmjs.org/jpeg-js/-/jpeg-js-0.4.4.tgz')
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(100_001)
    import base64, io
    expected = 'WZzeDOEtTOBK4Mdsar0IqEU5sMr3vSV2RqkAIzUEV2BHnUfKGyswWFPFwK5EeDo93K3FohSHbLAjj0s1Wzd+dg=='
    assert len(data) <= 100_000 and base64.b64encode(hashlib.sha512(data).digest()).decode() == expected
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        archive.extractall(work/'codec', filter='data')
    return work/'codec/package'

def read_upgrade_installers(manifest_path, root):
    manifest = manifest_path.resolve(strict=True)
    assert manifest.is_relative_to(root) and manifest.stat().st_size <= 16_384
    data = json.loads(manifest.read_text(encoding='utf-8'))
    assert data['schema'] == 'omc-native-upgrade-input-v1' and data['platform'] == sys.platform
    records = {}
    for role in ('legacy', 'candidate'):
        entry = data[role]
        name = entry['name']
        assert Path(name).name == name and name.lower().endswith('.exe' if WIN else '.pkg')
        package = (manifest.parent/name).resolve(strict=True)
        assert package.parent == manifest.parent and package.is_file()
        assert re.fullmatch('[a-f0-9]{64}', entry['sha256'])
        assert re.fullmatch('[a-f0-9]{64}', entry['asarSha256'])
        assert type(entry['bytes']) is int and 0 < entry['bytes'] <= 2 * 1024**3
        assert package.stat().st_size == entry['bytes']
        if role == 'legacy':
            assert (entry['bytes'], entry['sha256'], entry['asarSha256']) == LEGACY[sys.platform], 'Expected frozen Preview.21 installer and payload'
        else:
            assert re.fullmatch('[a-f0-9]{40}', entry['sourceTree'])
        with package.open('rb') as handle:
            assert hashlib.file_digest(handle,'sha256').hexdigest() == entry['sha256'], f'{role} installer SHA mismatch'
        records[role] = (entry,package)
    legacy, candidate = (records[role][0] for role in ('legacy','candidate'))
    assert legacy['sha256'] != candidate['sha256'] and legacy['asarSha256'] != candidate['asarSha256']
    return records


def installed_asar_sha(executable):
    asar = executable.parent/'resources/app.asar' if WIN else executable.parent.parent/'Resources/app.asar'
    with asar.open('rb') as handle:
        return hashlib.file_digest(handle,'sha256').hexdigest()


def run_upgrade(work, records, verify_candidate_payload=None):
    control = Path(__file__).with_suffix('.cjs')
    report = {'scope':'Native installer upgrade and fresh candidate workload with generated fixtures',
              'status':'FAIL', 'declaredCandidateSourceTree':records['candidate'][0]['sourceTree'], 'stages':{}}
    stage = 'prepare-fixtures'

    def install_checked(role):
        entry, package = records[role]
        executable = install(package).resolve(strict=True)
        assert installed_asar_sha(executable) == entry['asarSha256'], f'{role} ASAR identity mismatch'
        report['stages'][stage] = {key:entry[key] for key in ('sha256','bytes','asarSha256')}
        return executable

    def exercise(executable, profile_root, entry, mode, status):
        receipt_path = profile_root/'BASELINE.json'
        assert not receipt_path.exists(), 'Stale native workflow receipt'
        try:
            subprocess.run(['node',control,executable,profile_root,codec,f'--{mode}={entry["asarSha256"]}'],
                           check=True,timeout=1500)
        finally:
            if receipt_path.is_file():
                evidence_path = work/f'{stage}.json'
                receipt_path.rename(evidence_path)
                report['stages'][stage] = json.loads(evidence_path.read_text(encoding='utf-8'))
        receipt = report['stages'][stage]
        assert receipt['status'] == status and receipt['installedAsarSha256'] == entry['asarSha256']
        assert re.fullmatch('[a-f0-9]{64}',receipt['fixtureSetSha256']), 'Fixture identity missing'
        return receipt

    try:
        codec = jpeg_fixture_codec(work)
        legacy, candidate = (records[role][0] for role in ('legacy','candidate'))
        stage = 'legacy-install'
        legacy_executable = install_checked('legacy')
        stage = 'legacy-project'
        seed = exercise(legacy_executable,work,legacy,'upgrade-seed','PASS_SCOPED_NATIVE_UPGRADE_SEED')
        stage = 'candidate-install'
        executable = install_checked('candidate')
        assert executable == legacy_executable, 'Installer did not replace the same application'
        if verify_candidate_payload:
            stage = 'candidate-installed-payload'
            report['stages'][stage] = verify_candidate_payload(executable)
        stage = 'candidate-upgrade'
        upgrade = exercise(executable,work,candidate,'upgrade-verify','PASS_SCOPED_NATIVE_UPGRADE')
        assert upgrade['legacyAsarSha256'] == legacy['asarSha256']
        assert upgrade['fixtureSetSha256'] == seed['fixtureSetSha256'], 'Upgrade fixture set differs from legacy'
        stage = 'candidate-fresh-workload'
        fresh = work/'fresh'
        fresh.mkdir()
        workload = exercise(executable,fresh,candidate,'editor-check','PASS_SCOPED_NATIVE_EDITOR')
        assert workload['fixtureSetSha256'] == seed['fixtureSetSha256'], 'Fresh candidate fixture set differs from legacy'
        report['status'] = 'PASS_SCOPED_NATIVE_UPGRADE_AND_FRESH_WORKLOAD'
    except Exception:
        report['failedStage'] = stage
        raise
    finally:
        (work/'BASELINE.json').write_text(json.dumps(report,indent=2),encoding='utf-8')


def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('GITHUB_REPOSITORY') == 'Siiiiimon123/OMC-build-checks'
    assert os.environ.get('GITHUB_REF') == 'refs/heads/verify-preview24-high-use'
    assert os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
    assert (WIN and platform.machine() in ('AMD64','x86_64')) or (MAC and platform.machine() == 'arm64')
    assert not (APP.parent.exists() if WIN else Path('/Applications/OMC-Preview.app').exists())
    root = Path(os.environ['RUNNER_TEMP']).resolve()
    work = root/'omc-preview24-high-use'
    work.mkdir()
    assert shutil.disk_usage(root).free >= 5 * 1024**3
    if len(sys.argv)>1:
        assert len(sys.argv)==3 and sys.argv[1]=='--upgrade-manifest'
        run_upgrade(work,read_upgrade_installers(Path(sys.argv[2]),root))
        return
    name, length, digest = SPECS[sys.platform]
    installer = work/name
    download(f'https://omc.xiaoa.cyou/updates/targets/releases/{digest}.{name}', installer, length, digest)
    executable = install(installer)
    assert executable.is_file()
    assert installed_asar_sha(executable) == ASAR[sys.platform]
    installer.unlink()
    codec = jpeg_fixture_codec(work)
    subprocess.run(['node',Path(__file__).with_suffix('.cjs'),executable,work,codec],check=True,timeout=1500)

if __name__ == '__main__':
    main()

"""Public orchestration only. Product code and detailed evidence remain encrypted."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from ui_contract_adapter import patch_native_hook
from pkg_contract_adapter import patch_pkg_contract

REPO = 'Siiiiimon123/OMC-build-checks'
BRANCH = 'refs/heads/codex/mac-preview15-free-20261031'
AUTH = 'call_a5a735551f1642d699d1f3fd6bcc1f1f'
BASE_SHA = '9d75619194c66d1c6bbaeb5d7e63ad4b09b54605f99f7230289ab6f60378cc1a'
OVERLAY_SHA = 'c187e65a6395616234ee35b587739696c958c4474c6047de2597f56c528e06d1'
BOOT_SHA = '517e31e68253ae2b84cc5c81fc78c5feaf03ee657d28349fc24ee61af7f1e232'
SOURCE_TREE = '16e8ef7d949aef76e6bdb41dda021891088d9934'


def sha(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def save(path, obj):
    Path(path).write_text(json.dumps(obj, indent=2) + '\n', encoding='utf-8')


def phase(value, code=None):
    print(json.dumps({'phase': value, **({'exitCode': code} if code is not None else {})}), flush=True)


def adapt_bootstrap(original):
    # Normalize newline encoding only in this derived build adapter, never product source.
    text = original.decode('utf-8').replace('\r\n', '\n')
    old = "assert a.repository=='Siiiiimon123/OMC'and a.release_asset_id.isdigit()"
    assert text.count(old) == 1
    text = text.replace(old, "assert a.repository=='Siiiiimon123/OMC-build-checks'and a.release_asset_id=='684077774'")
    begin = "        image_root=work/'dmg-root';"
    end = "        check_source();assert all(p.stat().st_size<2*1024**3 for p in [pkg,dmg])"
    assert text.count(begin) == text.count(end) == 1
    left, rest = text.split(begin)
    _, right = rest.split(end)
    text = left + '        check_source();assert pkg.stat().st_size<2*1024**3' + right
    assert text.count('for p in [pkg,dmg]') == 1
    text = text.replace('for p in [pkg,dmg]', 'for p in [pkg]')
    # Only transient expansion is reclaimed, after its full byte readback was saved.
    marker = "result['pkgPayloadReadback']=verify_pkg_payload(app,expanded,pkg,reports/'PKG_PAYLOAD_READBACK.json');checkpoint()"
    assert text.count(marker) == 1
    text = text.replace(marker, marker + '\n        assert expanded.parent==work and expanded.name==\'pkg-expanded-for-readback\' and not expanded.is_symlink()\n        shutil.rmtree(expanded)')
    extracted = "        source=root/'source';safe=read(root/'metadata/source-manifest.safe.json')"
    assert text.count(extracted) == 1
    text = text.replace(extracted, "        assert transport.parent==work.parent and transport.name=='base.tar' and transport.is_file() and not transport.is_symlink()\n        save(reports/'TRANSPORT_RECLAIM.json',{'sha256':a.sha256,'bytes':transport.stat().st_size,'reason':'authenticated input fully extracted and each recorded file verified; owned ephemeral runner transport only'})\n        transport.unlink()\n" + extracted)
    text = patch_native_hook(text)
    text = patch_pkg_contract(text)
    compile(text, '<derived-native-bootstrap>', 'exec')
    return text.encode('utf-8')


def extract_overlay(archive, root):
    with zipfile.ZipFile(archive) as source:
        rows = source.infolist()
        assert len(rows) == 118 and len({r.filename for r in rows}) == 118
        for row in rows:
            path = PurePosixPath(row.filename)
            assert not row.is_dir() and not path.is_absolute() and '..' not in path.parts
            assert '\\' not in row.filename and path.parts[:2] == ('.github', 'omc-mac-preview15-final')
            assert ((row.external_attr >> 16) & 0o170000) != 0o120000
            target = root.joinpath(*path.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(row) as inp, target.open('xb') as out:
                shutil.copyfileobj(inp, out)
    return root / '.github/omc-mac-preview15-final'


def api(token, path, method='GET', data=None, content_type='application/json'):
    req = urllib.request.Request('https://api.github.com/repos/' + REPO + path,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'Content-Type': content_type}, method=method,
        data=json.dumps(data).encode() if data is not None else None)
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)


def publish(token, files, release_tag):
    release = api(token, '/releases', 'POST', {'tag_name': release_tag, 'name': release_tag,
        'target_commitish': os.environ['GITHUB_SHA'], 'draft': False, 'prerelease': True,
        'body': 'Authenticated encrypted build outputs. No plaintext product files.'})
    assets = []
    for path in files:
        assert path.stat().st_size < 2 * 1024**3
        url = 'https://uploads.github.com/repos/' + REPO + '/releases/' + str(release['id']) + '/assets?name=' + path.name
        # curl reads bytes from file, token from environment, and response only to private file.
        response = path.with_suffix(path.suffix + '.upload.json')
        curl_env = {**os.environ, 'GH_TOKEN': token}
        # Token remains in curl config stdin; never placed in command arguments.
        config = 'header = "Authorization: Bearer ' + token + '"\n'
        with response.open('wb') as out:
            rc = subprocess.run(['curl', '--fail', '--silent', '--config', '-', '--request', 'POST',
                '-H', 'Content-Type: application/octet-stream', '--upload-file', str(path), url],
                input=config.encode(), stdout=out, stderr=subprocess.DEVNULL, env=curl_env).returncode
        assert rc == 0
        receipt = json.loads(response.read_bytes())
        assert receipt['state'] == 'uploaded' and receipt['size'] == path.stat().st_size
        assert receipt['digest'] == 'sha256:' + sha(path)
        assets.append({'name': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path), 'id': receipt['id']})
    return {'releaseId': release['id'], 'tag': release_tag, 'assets': assets}


def main():
    assert AUTH.startswith('call_'), 'ADDITIONAL_RUN_NOT_AUTHORIZED'
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_REPOSITORY') == REPO
    assert os.environ.get('GITHUB_REF') == BRANCH and os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
    assert sys.platform == 'darwin' and platform.machine() == 'arm64' and sys.version_info[:3] == (3, 12, 10)
    assert os.environ.get('RUNNER_OS') == 'macOS' and os.environ.get('RUNNER_ARCH') == 'ARM64'
    key = os.environ.pop('OMC_PREVIEW15_TRANSPORT_KEY')
    token = os.environ.pop('GH_TOKEN')
    assert len(key) == 64 and all(c in '0123456789abcdef' for c in key)
    here = Path(__file__).resolve().parent
    work = Path(os.environ['RUNNER_TEMP']).resolve() / 'omc-preview15-encrypted-once'
    work.mkdir(mode=0o700)
    detail = work / 'private-logs'
    detail.mkdir(mode=0o700)
    out = work / 'encrypted-output'
    out.mkdir(mode=0o700)
    helper = here / 'transport.cjs'
    manifest = here / 'INPUTS.json'
    frozen = json.loads(manifest.read_bytes())
    assert [(a['id'], a['plaintextBytes'], a['plaintextSha256']) for a in frozen['assets']] == [
        ('base', 1061386240, BASE_SHA), ('overlay', 757063, OVERLAY_SHA)]
    secret_env = {**os.environ, 'OMC_PREVIEW15_TRANSPORT_KEY': key}
    clean_env = {**os.environ, 'PYTHONPATH': str(here)}
    save(detail / 'PLATFORM.json', {'machine': platform.machine(), 'diskFreeBytes': shutil.disk_usage(work).free,
        'authorization': AUTH, 'repository': REPO, 'sourceTree': SOURCE_TREE, 'originalBaseAssetId': '684077774'})
    status = 1
    package = None
    try:
        phase('native-pkg-contract-preflight')
        with (detail / 'pkg-preflight.log').open('wb') as log:
            subprocess.run([sys.executable, here / 'pkg_contract_preflight.py', work / 'pkg-preflight', detail / 'pkg-preflight'],
                check=True, env=clean_env, stdout=log, stderr=subprocess.STDOUT)
        for name in ('base', 'overlay'):
            phase('authenticate-' + name)
            dest = work / ('base.tar' if name == 'base' else 'overlay.zip')
            with (detail / ('transport-' + name + '.log')).open('wb') as log:
                subprocess.run(['node', helper, 'fetch', '--manifest', manifest, '--id', name, '--output', dest],
                    check=True, env=secret_env, stdout=log, stderr=subprocess.STDOUT)
        adapter = extract_overlay(work / 'overlay.zip', work / 'overlay')
        bootstrap = adapter / 'native_online_bootstrap.py'
        assert sha(bootstrap) == BOOT_SHA
        original = bootstrap.read_bytes()
        derived = adapt_bootstrap(original)
        bootstrap.write_bytes(derived)
        save(detail / 'ADAPTER.json', {'originSha256': BOOT_SHA, 'derivedSha256': sha(bootstrap),
            'changes': ['approved public repository binding', 'PKG only; no DMG',
                        'reclaim authenticated base.tar after complete verified extraction',
                        'remove verified transient expanded PKG only',
                        'calibrate external native UI harness to automatic preview/current refresh control',
                        'native explicit nonrelocatable component plus synthesized distribution'],
            'productSourceChangedByWrapper': False})
        phase('native-build-and-exact-pkg-acceptance')
        with (detail / 'native-bootstrap.log').open('wb') as log:
            result = subprocess.run([sys.executable, bootstrap, '--transport', work / 'base.tar', '--sha256', BASE_SHA,
                '--work', work / 'build', '--authorization-id', AUTH, '--release-asset-id', '684077774', '--repository', REPO],
                env=clean_env, stdout=log, stderr=subprocess.STDOUT)
        status = result.returncode
        if status == 0:
            result = json.loads((work / 'build/reports/BUILD_RESULT.json').read_bytes())
            assert result['status'] == 'PASS_NATIVE_BUILD_AND_SYNTHETIC_ACCEPTANCE_UNSIGNED_PREVIEW'
            assert result['nativePreviewCandidateReady'] is True
            assert len(result['packages']) == 1 and result['effectiveSourceBytesUnchanged'] is True
            row = result['packages'][0]
            package = work / 'build/output' / row['name']
            assert package.parent == work / 'build/output' and package.suffix == '.pkg'
            assert package.stat().st_size == row['bytes'] and sha(package) == row['sha256']
        phase('native-result', status)
    except Exception:
        status = 1
        # Detailed exception is private; no product content appears on public stdout.
        import traceback
        (detail / 'WRAPPER_FAILURE.txt').write_text(traceback.format_exc(), encoding='utf-8')
        phase('native-result', status)
    release_tag = 'omc-preview15-encrypted-result-' + os.environ['GITHUB_RUN_ID']
    files = []
    manifests = []
    if status == 0 and package is not None:
        encrypted = out / 'package.enc'
        pm = out / 'package.json'
        with (detail / 'encrypt-pkg.log').open('wb') as log:
            subprocess.run(['node', helper, 'encrypt', '--input', package, '--output', encrypted,
                '--id', 'pkg', '--manifest', pm], env=secret_env, check=True, stdout=log, stderr=subprocess.STDOUT)
        manifests.extend(json.loads(pm.read_bytes())['assets'])
        files.append(encrypted)
    reports_tar = work / 'reports.tar'
    with tarfile.open(reports_tar, 'w') as tar:
        tar.add(detail, arcname='wrapper')
        if (work / 'build/reports').is_dir():
            tar.add(work / 'build/reports', arcname='native')
    encrypted = out / 'reports.enc'
    rm = out / 'reports.json'
    # Do not put this command's log inside the tar being encrypted.
    with (work / 'encrypt-reports.log').open('wb') as log:
        subprocess.run(['node', helper, 'encrypt', '--input', reports_tar, '--output', encrypted,
            '--id', 'reports', '--manifest', rm], env=secret_env, check=True, stdout=log, stderr=subprocess.STDOUT)
    manifests.extend(json.loads(rm.read_bytes())['assets'])
    files.append(encrypted)
    for row in manifests:
        row['url'] = 'https://github.com/' + REPO + '/releases/download/' + release_tag + '/' + ('package.enc' if row['id'] == 'pkg' else 'reports.enc')
    result_manifest = out / 'OUTPUTS.json'
    save(result_manifest, {'schema': 'omc-aes256gcm-build-transport-v1', 'assets': manifests,
        'buildExitCode': status, 'sourceTree': SOURCE_TREE, 'runId': os.environ['GITHUB_RUN_ID'],
        'memberGatekeeperDownloadTested': False})
    files.append(result_manifest)
    phase('publish-encrypted-result')
    receipt = publish(token, files, release_tag)
    print(json.dumps({'phase': 'encrypted-result-published', **receipt}), flush=True)
    return status


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        phase('wrapper-failed', 1)
        raise SystemExit(1)

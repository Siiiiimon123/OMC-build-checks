import hashlib,json,os,subprocess,urllib.request
from pathlib import Path
REPO='Siiiiimon123/OMC-build-checks'

def sha(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()

def save(path, obj):
    Path(path).write_text(json.dumps(obj, indent=2) + '\n', encoding='utf-8')

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
            rc = subprocess.run(['curl', '--fail', '--silent', '--max-time', '900', '--config', '-', '--request', 'POST',
                '-H', 'Content-Type: application/octet-stream', '--upload-file', str(path), url],
                input=config.encode(), stdout=out, stderr=subprocess.DEVNULL, env=curl_env).returncode
        assert rc == 0
        receipt = json.loads(response.read_bytes())
        assert receipt['state'] == 'uploaded' and receipt['size'] == path.stat().st_size
        assert receipt['digest'] == 'sha256:' + sha(path)
        assets.append({'name': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path), 'id': receipt['id']})
    return {'releaseId': release['id'], 'tag': release_tag, 'assets': assets}

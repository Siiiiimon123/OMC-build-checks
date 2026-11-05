"""Split only existing authenticated ciphertext. No decryption, key or build."""
from pathlib import Path
import hashlib
import json
import os
import sys
import zipfile

assert os.environ.get('GITHUB_ACTIONS') == 'true'
assert os.environ.get('GITHUB_REPOSITORY') == 'Siiiiimon123/OMC-build-checks'
root = Path(sys.argv[1])
limit = 128 * 1024**2
with zipfile.ZipFile(root / 'original.zip') as z:
    assert set(z.namelist()) == {'package.enc', 'PACKAGE_READY.json'}
    assert z.getinfo('PACKAGE_READY.json').file_size < 4096
    manifest = json.loads(z.read('PACKAGE_READY.json'))
    assert manifest['schema'] == 'omc-aes256gcm-build-transport-v1'
    assert len(manifest['assets']) == 1
    asset = manifest['assets'][0]
    assert asset['id'] == 'pkg' and asset['plaintextBytes'] == 803348413
    assert asset['plaintextSha256'] == 'daade4392f5b77262fbd1f53b4ffbcb89e73290952f1a0779739c0ff8d97eb27'
    assert z.getinfo('package.enc').file_size == asset['ciphertextBytes'] == asset['plaintextBytes']
    parts = []
    total = 0
    whole = hashlib.sha256()
    with z.open('package.enc') as reader:
        while total < asset['ciphertextBytes']:
            name = 'part-' + str(len(parts)).zfill(3) + '.bin'
            part_hash = hashlib.sha256()
            count = 0
            with (root / name).open('xb') as writer:
                while count < limit:
                    chunk = reader.read(min(1024**2, limit-count))
                    if not chunk:
                        break
                    writer.write(chunk)
                    whole.update(chunk)
                    part_hash.update(chunk)
                    count += len(chunk)
                    total += len(chunk)
            assert count > 0
            parts.append({'name': name, 'bytes': count, 'sha256': part_hash.hexdigest()})
        assert not reader.read(1)
    assert total == asset['ciphertextBytes'] and whole.hexdigest() == asset['ciphertextSha256']
assert len(parts) == 6
index = {'schema': 'omc-existing-raw-cipher-split-v2', 'originalArtifact': 13402959173,
    'originalRun': 42002063142, 'originalZipSha256': 'fe797487c19c48014add51b246b259d25df5695a7c42d0de2eed03f1cf9190ad',
    'asset': asset, 'parts': parts, 'decryptionPerformed': False, 'secretUsed': False,
    'productBytesChanged': False, 'sourceOrModelRebuilt': False, 'feeUSD': 0}
(root / 'INDEX.json').write_text(json.dumps(index, indent=2)+'\n', encoding='utf8')
print(json.dumps(index))

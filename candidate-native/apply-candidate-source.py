"""Stage a verified source increment on an isolated native build worker."""

from base64 import b64decode
import gzip
from hashlib import sha1, sha256
from importlib import import_module
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
import re
import sys
from tempfile import TemporaryDirectory


tree_hash = import_module('candidate-source-tree').tree_hash
MAX_SOURCE_BYTES = 16 * 1024**2
MAX_INCREMENT_BYTES = 512 * 1024
VERSION_FILES = ('package.json', 'package-lock.json', 'public/release-metadata.json')


def sha(data):
    return sha256(data).hexdigest()


def source_name(name):
    path = PurePosixPath(name)
    assert path.parts and name == path.as_posix() and not path.is_absolute()
    assert all(part not in ('.','..') for part in path.parts) and '\\' not in name and ':' not in name
    return Path(*path.parts)


def verify_source(record, data):
    assert record['mode'] == '100644' and len(data) == record['bytes'], record['path']
    assert sha(data) == record['sha256'], record['path']
    header = f'blob {len(data)}\0'.encode()
    assert sha1(header+data).hexdigest() == record['gitBlobSha1'], record['path']


def stamp_test_version(content, records, baseline_version, test_version):
    pattern = r'1\.0\.21-preview\.(\d+)'
    previous = re.fullmatch(pattern,baseline_version)
    current = re.fullmatch(pattern,test_version)
    assert previous and current and int(current[1]) > int(previous[1])
    for name in VERSION_FILES:
        old = content[name]
        old_field = f'"version": "{baseline_version}"'.encode()
        new_field = f'"version": "{test_version}"'.encode()
        assert old.count(old_field) == (2 if name == 'package-lock.json' else 1), name
        new = old.replace(old_field,new_field)
        expected = json.loads(old)
        expected['version'] = test_version
        if name == 'package-lock.json':
            assert expected['packages']['']['version'] == baseline_version
            expected['packages']['']['version'] = test_version
        assert json.loads(new) == expected, name
        content[name] = new
        records[name] = {**records[name], 'bytes':len(new), 'sha256':sha(new),
                         'gitBlobSha1':sha1(f'blob {len(new)}\0'.encode()+new).hexdigest()}


def read_increment(file, handoff):
    assert 0 < handoff['compressedBytes'] <= MAX_INCREMENT_BYTES
    assert file.stat().st_size == handoff['compressedBytes']
    packed = file.read_bytes()
    assert sha(packed) == handoff['plaintextSha256'], 'Candidate source digest mismatch'
    with gzip.GzipFile(fileobj=BytesIO(packed)) as stream:
        content = stream.read(MAX_SOURCE_BYTES+1)
    assert len(content) <= MAX_SOURCE_BYTES
    return json.loads(content)


def source_inventory(source):
    files = set()
    for entry in source.rglob('*'):
        assert not entry.is_symlink() and not entry.is_junction(), 'Unexpected source link'
        if entry.is_file():
            files.add(entry.relative_to(source).as_posix())
        else:
            assert entry.is_dir(), 'Unexpected source member'
    return files


def stage_source(source, destination, platform, baseline, handoff, increment, test_version=None):
    assert platform in ('windows','mac')
    assert source.is_absolute() and source.is_dir() and not source.is_symlink() and not source.is_junction()
    assert source.parent == destination.parent and not destination.exists() and not destination.is_symlink()
    scope = handoff['scopes'][platform]
    assert baseline['sourceTree'] == scope['before'], 'Wrong platform source baseline'
    records = {row['path']:row for row in baseline['records']}
    assert len(records) == len(baseline['records']) == scope['baselineFiles']
    assert len({name.casefold() for name in records}) == len(records)
    assert tree_hash(records.values()) == scope['before'], 'Invalid baseline source tree'
    assert source_inventory(source) == records.keys(), 'Unexpected or missing baseline source file'
    assert sum(row['bytes'] for row in records.values()) <= MAX_SOURCE_BYTES
    content = {}
    for name,row in records.items():
        path = source/source_name(name)
        assert path.stat().st_size == row['bytes'], name
        data = path.read_bytes()
        verify_source(row,data)
        content[name] = data

    changes = increment['changesByPlatform'][platform]
    assert len(changes) == scope['changes'] == len({row['path'] for row in changes})
    for change in changes:
        name = change['path']
        source_name(name)
        assert not name.startswith('ai-training/'), name
        previous = records.get(name)
        assert (previous and previous['sha256']) == change['beforeSha256'], name
        encoded = increment['changes'][name]
        record = {key:value for key,value in encoded.items() if key != 'data'}
        assert record == {key:value for key,value in change.items() if key != 'beforeSha256'}, name
        data = b64decode(encoded['data'],validate=True)
        verify_source(record,data)
        records[name],content[name] = record,data
    assert len(records) == len({name.casefold() for name in records}) == scope['files']
    assert tree_hash(records.values()) == scope['after'], 'Candidate source tree mismatch'
    assert sum(map(len,content.values())) <= MAX_SOURCE_BYTES
    assert all(json.loads(content[name])['version'] == handoff['baselineVersion'] for name in VERSION_FILES)
    if test_version:
        stamp_test_version(content,records,handoff['baselineVersion'],test_version)
    build_tree = tree_hash(records.values())

    # Package builders receive the complete tree only after a readback. The original
    # disposable baseline stays available if a write fails before the rename.
    with TemporaryDirectory(dir=source.parent,prefix='staged-source-') as location:
        root = Path(location).resolve(strict=True)
        assert root.parent == source.parent
        staged = root/'candidate'
        staged.mkdir()
        for name,data in content.items():
            target = staged/source_name(name)
            target.parent.mkdir(parents=True,exist_ok=True)
            with target.open('xb') as stream:
                stream.write(data)
        assert source_inventory(staged) == records.keys()
        for name,row in records.items():
            verify_source(row,(staged/source_name(name)).read_bytes())
        staged.rename(destination)
    return {'sourceTree':build_tree, 'baseSourceTree':scope['before'], 'projectedSourceTree':scope['after'],
            'version':test_version or handoff['baselineVersion'],
            'records':sorted(records.values(),key=lambda row:row['path'])}


def main():
    assert len(sys.argv) in (8,9)
    platform, source, destination, baseline, handoff, archive, expected_handoff = sys.argv[1:8]
    test_version = sys.argv[8] if len(sys.argv) == 9 else None
    handoff_data = Path(handoff).read_bytes()
    assert re.fullmatch('[a-f0-9]{64}',expected_handoff) and sha(handoff_data) == expected_handoff
    release = json.loads(handoff_data)
    source, destination = Path(source).absolute(), Path(destination).absolute()
    assert source.parent.resolve(strict=True) == source.parent
    result = stage_source(source,destination,platform,json.loads(Path(baseline).read_bytes()),release,
                          read_increment(Path(archive),release),test_version)
    print(json.dumps(result,separators=(',',':')))


if __name__ == '__main__':
    main()

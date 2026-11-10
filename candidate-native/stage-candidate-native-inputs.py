"""Recover the existing encrypted source chain for the candidate build worker."""

from base64 import b64decode
import gzip
from hashlib import sha1, sha256
from importlib import import_module
import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZipFile


stage = import_module('apply-candidate-source')
VERSION = '1.0.21-preview.24'
TRANSPORT_SHA = '19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f'
LEGACY_ARTIFACTS = {
    'windows': {'id':13523823651,'bytes':806703885,'sha256':'1c81315b819836b0de29112a08ee95b1e7ec94735817b86d844e651b89722258'},
    'mac': {'id':13526504342,'bytes':992016611,'sha256':'f8997dfcffaeb4a1e9214946cb8d4e39601b216770300156728a0f9c1425e33d'},
}


def read(path):
    return json.loads(path.read_bytes())


def unpack(path, output, limit):
    output.mkdir()
    with ZipFile(path) as archive:
        members = [entry for entry in archive.infolist() if not entry.is_dir()]
        assert len({entry.filename.casefold() for entry in members}) == len(members)
        assert sum(entry.file_size for entry in members) <= limit
        for entry in members:
            assert (entry.external_attr >> 16) & 0o170000 != 0o120000
            file = output/stage.source_name(entry.filename)
            file.parent.mkdir(parents=True,exist_ok=True)
            with file.open('xb') as writer, archive.open(entry) as reader:
                shutil.copyfileobj(reader,writer)


def replace_source(source, name, previous_sha, expected_sha, data):
    file = source/stage.source_name(name)
    assert (stage.sha(file.read_bytes()) if file.exists() else None) == previous_sha, name
    assert stage.sha(data) == expected_sha, name
    file.parent.mkdir(parents=True,exist_ok=True)
    file.write_bytes(data)


def source_records(source):
    records = []
    for name in sorted(stage.source_inventory(source)):
        data = (source/stage.source_name(name)).read_bytes()
        records.append({'path':name,'mode':'100644','bytes':len(data),'sha256':stage.sha(data),
                        'gitBlobSha1':sha1(f'blob {len(data)}\0'.encode()+data).hexdigest()})
    return {'sourceTree':stage.tree_hash(records),'records':records}


def recover(history, capsule, control_dir, inputs, platform, node, key_file=None):
    assert platform in ('windows','mac')
    assert not inputs.exists() and inputs.parent.is_dir()
    transport = history/'final19/transport.cjs'
    assert stage.sha(transport.read_bytes()) == TRANSPORT_SHA
    old, helpers, current, patch = (history/name for name in ('opt20','native23','probability23','update24'))
    handoff, plan = read(capsule/'SOURCE_HANDOFF.json'),read(control_dir/'BUILD_CONTROLS.json')
    scope = read(patch/'INPUT.json')['scopes'][platform]
    inputs.mkdir()
    builder_inputs = inputs/'builder-inputs'

    with TemporaryDirectory(dir=inputs,prefix='source-transport-') as location:
        scratch = Path(location).resolve(strict=True)
        assert scratch.parent == inputs

        def decrypt(asset, encrypted, manifest):
            output = scratch/(asset+'.plain')
            command = [node,transport,'decrypt','--id',asset,'--input',encrypted,'--output',output,'--manifest',manifest]
            if key_file is not None:
                command.extend(('--key-file',key_file))
            subprocess.run(command,check=True,timeout=120,stdout=subprocess.DEVNULL)
            return output

        def envelope(directory, filename):
            encrypted = scratch/(filename+'.enc')
            encrypted.write_bytes(b64decode((directory/filename).read_bytes().strip(),validate=True))
            return encrypted

        source = inputs/'preview24-source'
        old_cipher = scratch/'base-source.enc'
        old_cipher.write_bytes(b''.join((old/('source.part%02d.enc' % i)).read_bytes() for i in range(14)))
        unpack(decrypt('source-r20',old_cipher,old/'source.transport.json'),source,16*1024**2)
        overlay = decrypt('r20-overlay',envelope(old,'overlay.b64'),old/'overlay.transport.json')
        with ZipFile(overlay) as archive:
            rows = json.loads(archive.read('PATCH.json'))
            assert set(archive.namelist()) == {'PATCH.json',*(row['path'] for row in rows)}
            for row in rows:
                replace_source(source,row['path'],row['beforeSha256'],row['sha256'],archive.read(row['path']))
        unpack(decrypt('native23-helpers',envelope(helpers,'helpers.b64'),helpers/'HELPERS.transport.json'),builder_inputs,2*1024**2)
        parts = read(current/'CURRENT_SOURCE_INPUT.json')['parts']
        assert type(parts) is int and 0 < parts <= 32
        current_cipher = scratch/'current-source.enc'
        current_cipher.write_bytes(b''.join(b64decode((current/f'current-source.part{i}.b64').read_bytes().strip(),validate=True)
                                            for i in range(parts)))
        with ZipFile(decrypt('current-source-checks',current_cipher,current/'CURRENT_SOURCE.transport.json')) as archive:
            baseline = json.loads(archive.read('BASELINE.json'))
            assert source_records(source)['sourceTree'] == baseline['sourceTree'] == '883787ae0ea60c56d348ff758fa150fb3f40007d'
            candidate23 = read(builder_inputs/'WINDOWS_SOURCE_RECORDS.json') if platform == 'windows' else json.loads(archive.read('CANDIDATE.json'))
            records23 = {row['path']:row for row in candidate23['records']}
            for row in json.loads(archive.read('PATCH.json')):
                name = row['path']
                if records23.get(name,{}).get('sha256') == row['sha256']:
                    replace_source(source,name,row['beforeSha256'],row['sha256'],archive.read(name))
        assert source_records(source)['sourceTree'] == candidate23['sourceTree'] == scope['before']

        prior24 = decrypt('update24-source',envelope(patch,'overlay24.b64'),patch/'OVERLAY.json')
        with gzip.open(prior24,'rb') as stream:
            changes24 = json.loads(stream.read(768*1024))
        rows = changes24['changesByPlatform'][platform]
        assert len(rows) == len({row['path'] for row in rows}) == 11
        for row in rows:
            name = row['path']
            data = b64decode(changes24['changes'][name]['data'],validate=True)
            assert len(data) == row['bytes']
            replace_source(source,name,row['beforeSha256'],row['sha256'],data)
        assert source_records(source)['sourceTree'] == scope['after']
        if platform == 'windows':
            approval = read(builder_inputs/'ACCEPTED_RUNTIME_VERIFICATION.json')['approved']
            (source/'ai-training/ai-service-build-inputs.json').write_bytes((builder_inputs/'AI_ENTRY_REBUILD_INPUTS.json').read_bytes())
            (source/'ai-training/approved-ai-runtime.json').write_bytes((json.dumps(approval,ensure_ascii=False,indent=2)+'\n').encode())
        baseline24 = source_records(source)
        assert baseline24['sourceTree'] == handoff['scopes'][platform]['before']
        candidate_plain = decrypt('candidate-source',capsule/'candidate-source.enc',capsule/'TRANSPORT.json')
        result = stage.stage_source(source,inputs/'source',platform,baseline24,handoff,
                                    stage.read_increment(candidate_plain,handoff),plan['testVersion'])
        assert result['sourceTree'] == plan['sourceTrees'][platform]
        (builder_inputs/'source19-records.json').write_text(json.dumps(result),encoding='utf-8')

    controls = inputs/'controls'
    controls.mkdir()
    (controls/'BUILD_CONTROLS.json').write_bytes((control_dir/'BUILD_CONTROLS.json').read_bytes())
    for name, expected in plan['controlSha256'].items():
        assert Path(name).name == name
        file = control_dir/name
        assert stage.sha(file.read_bytes()) == expected
        (controls/name).write_bytes(file.read_bytes())
    for name in ('contracts.cjs','bootstrap.cjs','provision-subject-model.cjs','verify-mac-entry.cjs'):
        (controls/name).write_bytes((helpers/name).read_bytes())
    fetch = (helpers/'fetch-base.mjs').read_text(encoding='utf-8')
    assert fetch.count('refs/heads/verify-optimization20') == 1
    assert plan['runnerRef'] == 'refs/heads/verify-native-candidate'
    (controls/'fetch-base.mjs').write_text(fetch.replace('refs/heads/verify-optimization20',plan['runnerRef']),encoding='utf-8')
    (controls/'BASE20_ARTIFACTS.json').write_text(json.dumps(LEGACY_ARTIFACTS),encoding='utf-8')
    (controls/'transport.cjs').write_bytes(transport.read_bytes())
    if platform == 'windows':
        (controls/'prefetch-win-tools.cjs').write_bytes((patch/'prefetch-win-tools.cjs').read_bytes())
    (controls/'pkg_contract_adapter.py').write_bytes((builder_inputs/'pkg_contract_adapter.py').read_bytes())
    (inputs/'packages').mkdir()
    receipt = {'platform':platform,'version':result['version'],'baseSourceTree':baseline24['sourceTree'],
               'candidateSourceTree':result['sourceTree'],'sourceFiles':len(result['records']),
               'buildControlSha256':sha256((controls/'BUILD_CONTROLS.json').read_bytes()).hexdigest()}
    (inputs/'STAGED.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    return receipt


if __name__ == '__main__':
    assert len(sys.argv) == 7
    node, history, capsule, controls, target, platform = sys.argv[1:]
    executable = shutil.which(node)
    assert executable is not None, 'Node executable unavailable'
    print(json.dumps(recover(*(Path(name).absolute() for name in (history,capsule,controls,target)),
                             platform,Path(executable).resolve(strict=True))))

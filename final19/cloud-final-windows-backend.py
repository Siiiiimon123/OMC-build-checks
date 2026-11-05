"""Cloud-only clean entry rebuild with a byte-verified existing runtime closure.

Reuses the project's build_exe_reuse.spec and verified incremental assembly
contract. No local environment setup, model acquisition or release approval.
"""
from pathlib import Path, PurePosixPath
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile

SOURCE_ENTRY_SHA = '03913da1e4167dd9fbd9ec426e01678ef31450d3b55bf3f2befec378c495550e'
OLD_INPUT_SHA = '7db672ed68cf80deb509fa5444cb1e538f68d0d5671f0ab9f8f74888c29d5207'
NEW_INPUT_SHA = '2c4583587299a6b17866796ca681d833d18d23d7f636e26ace3d897bcb784e23'
OLD_RUNTIME_TREE = 'e284b89723131ef5b348b1fc8c8dc85da2079d1c14e0adcf2c908c77adfb7f47'


def sha(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load(file):
    return json.loads(Path(file).read_bytes())


def save(file, value):
    with Path(file).open('x', encoding='utf8') as stream:
        stream.write(json.dumps(value, indent=2) + '\n')


def safe(root, name):
    parts = PurePosixPath(name)
    assert name and not parts.is_absolute() and '\\' not in name and ':' not in name
    assert all(part not in ('', '.', '..') for part in name.split('/'))
    file = root.joinpath(*parts.parts)
    assert file.resolve().is_relative_to(root.resolve()) and not file.is_symlink()
    return file


def inventory(root):
    rows = {}
    for file in sorted(root.rglob('*')):
        assert not file.is_symlink(), 'RUNTIME_SYMLINK'
        if file.is_file() and file.name != 'build-evidence.json':
            rows[file.relative_to(root).as_posix()] = {'size': file.stat().st_size, 'sha256': sha(file)}
    return rows


def tree(rows):
    text = ''.join(f"{name}\0{row['size']}\0{row['sha256']}\n" for name, row in sorted(rows.items()))
    return hashlib.sha256(text.encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'runtime', 'candidate-inputs', 'resource-tar', 'reports', 'work'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
    assert os.environ.get('GITHUB_REPOSITORY') == 'Siiiiimon123/OMC-build-checks'
    assert sys.platform == 'win32' and platform.python_version() == '3.14.5'
    assert platform.machine().lower() in ('amd64', 'x86_64')
    source, runtime, reports, work = map(lambda p: Path(p).resolve(),
        (args.source, args.runtime, args.reports, args.work))
    owned = Path(os.environ['RUNNER_TEMP']).resolve()
    for file in (source, runtime, reports, work, Path(args.resource_tar).resolve(),
                 Path(args.candidate_inputs).resolve()):
        assert file.is_relative_to(owned), 'CLOUD_WORKSPACE_REQUIRED'
    reports.mkdir(parents=True, exist_ok=True)
    work.mkdir(exist_ok=False)
    ai = source / 'ai-training'
    assert sha(ai / 'scripts/inference_server_onnx.py') == SOURCE_ENTRY_SHA
    assert sha(ai / 'ai-service-build-inputs.json') == OLD_INPUT_SHA
    assert sha(args.candidate_inputs) == NEW_INPUT_SHA
    approval = load(ai / 'approved-ai-runtime.json')
    before = inventory(runtime)
    assert tree(before) == OLD_RUNTIME_TREE == approval['runtime_tree_sha256']
    assert len(before) == approval['runtime_file_count']
    assert sha(runtime / 'ai-service.exe') == approval['executable']['sha256']
    assert sha(runtime / 'build-evidence.json') == approval['build_evidence_sha256']
    save(reports / 'BACKEND_BASE_RUNTIME.json', {'tree': tree(before), 'files': before})

    # Fixed previous model/runtime bytes are linked into the compiler input;
    # never edit a shared input and never weaken the 94-input verifier.
    by_content = {}
    for name, row in before.items():
        by_content.setdefault((row['size'], row['sha256']), runtime / name)
    manifest = load(args.candidate_inputs)
    missing, linked = [], []
    for row in manifest['inputs']:
        root = source if row.get('root') == 'project' else ai
        target = safe(root, row['path'])
        expected = (row['size'], row['sha256'])
        if target.exists():
            assert (target.stat().st_size, sha(target)) == expected, 'SOURCE_INPUT_CHANGED:' + row['path']
        elif expected in by_content:
            target.parent.mkdir(parents=True, exist_ok=True)
            os.link(by_content[expected], target)
            assert (target.stat().st_size, sha(target)) == expected
            linked.append(row['path'])
        else:
            missing.append((target, row))
    with tarfile.open(args.resource_tar, 'r:') as archive:
        bundle = json.load(archive.extractfile('BUNDLE-MANIFEST.json'))
        declared = {(row['bytes'], row['sha256']): row for row in bundle['files']}
        for target, row in missing:
            entry = declared.get((row['size'], row['sha256']))
            assert entry, 'REBUILD_INPUT_UNAVAILABLE:' + row['path']
            member = archive.getmember(entry['path'])
            assert member.isfile() and member.size == row['size'] and not member.issym() and not member.islnk()
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as reader, target.open('xb') as writer:
                shutil.copyfileobj(reader, writer, 1024 * 1024)
            assert sha(target) == row['sha256'], 'TAR_RESOURCE_BYTES_CHANGED'
    shutil.copyfile(args.candidate_inputs, ai / 'ai-service-build-inputs.json')
    sys.path.insert(0, str(ai / 'scripts'))
    from verify_ai_service_build_inputs import verify_manifest
    from build_ai_service import verify_environment
    verified = verify_manifest(ai / 'ai-service-build-inputs.json', expected_platform='win32',
        expected_arch='x64', expected_provider='DmlExecutionProvider')
    save(reports / 'BACKEND_INPUT_VERIFICATION.json', verified)
    assert verified['valid'], 'ALL_FROZEN_INPUTS_MUST_MATCH'
    actual_python, mismatch = verify_environment(ai / 'requirements-ai-service.lock.txt', '3.14.5')
    assert not mismatch, 'PINNED_ENVIRONMENT_MISMATCH:' + json.dumps(mismatch)
    closure = work / 'closure.json'
    env = dict(os.environ)
    for name in ('OMC_PREVIEW15_TRANSPORT_KEY', 'GH_TOKEN', 'GITHUB_TOKEN', 'PYTHONPATH', 'PYTHONHOME'):
        env.pop(name, None)
    env['OMC_BACKEND_CLOSURE_PATH'] = str(closure)
    command = [sys.executable, '-B', '-m', 'PyInstaller', '--clean', '--noconfirm',
        '--distpath', str(work / 'dist'), '--workpath', str(work / 'analysis'), str(ai / 'build_exe_reuse.spec')]
    with (reports / 'BACKEND_COMPILE.log').open('wb') as log:
        subprocess.run(command, cwd=ai, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=900, check=True)
    executable = work / 'dist/ai-service.exe'
    assert executable.is_file() and sha(ai / 'scripts/inference_server_onnx.py') == SOURCE_ENTRY_SHA
    desired, locations = {}, {}
    actual_closure = load(closure)
    assert set(actual_closure) == {'binaries', 'datas', 'zipfiles'}
    for kind, rows in actual_closure.items():
        for destination, origin, typecode in rows:
            name = '_internal/' + destination.replace('\\', '/')
            safe(runtime, name)
            assert name not in desired, 'DUPLICATE_CLOSURE_TARGET'
            origin = Path(origin)
            assert origin.is_file() and not origin.is_symlink()
            desired[name] = {'size': origin.stat().st_size, 'sha256': sha(origin)}
            locations[name] = origin
    desired['ai-service.exe'] = {'size': executable.stat().st_size, 'sha256': sha(executable)}
    locations['ai-service.exe'] = executable
    added, removed = sorted(desired.keys() - before.keys()), sorted(before.keys() - desired.keys())
    changed = sorted(name for name in desired.keys() & before.keys() if desired[name] != before[name])
    comparison = {'added': added, 'removed': removed, 'changed': changed,
        'sameCount': sum(desired.get(name) == row for name, row in before.items()), 'closureSha256': sha(closure)}
    save(reports / 'BACKEND_ACTUAL_CLOSURE_COMPARISON.json', comparison)
    assert not added and not removed, 'UNEXPECTED_CLOSURE_MEMBERS_REVIEW_REQUIRED'
    assert set(changed) <= {'ai-service.exe', '_internal/base_library.zip'}, 'UNEXPECTED_NATIVE_OR_DATA_CHANGE_REVIEW_REQUIRED'
    for name in changed:
        target = safe(runtime, name)
        temporary = target.with_name(target.name + '.new')
        with locations[name].open('rb') as reader, temporary.open('xb') as writer:
            shutil.copyfileobj(reader, writer, 1024 * 1024)
        assert sha(temporary) == desired[name]['sha256']
        os.replace(temporary, target)
    actual = inventory(runtime)
    assert actual == desired
    evidence = load(runtime / 'build-evidence.json')
    evidence.update(built_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        input_manifest_sha256=NEW_INPUT_SHA, runtime_tree_sha256=tree(actual), runtime_file_count=len(actual),
        executable={'path': 'ai-service.exe', **actual['ai-service.exe']},
        incrementalAssembly={'mode': 'clean-PyInstaller-entry-and-verified-unchanged-closure',
            'sourceEntrySha256': SOURCE_ENTRY_SHA, 'closureSha256': sha(closure),
            'baseRuntimeTreeSha256': OLD_RUNTIME_TREE, 'runId': os.environ['GITHUB_RUN_ID'],
            'changed': changed, 'added': added, 'removed': removed})
    (runtime / 'build-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf8')
    approval.update(input_manifest_sha256=NEW_INPUT_SHA, build_evidence_sha256=sha(runtime / 'build-evidence.json'),
        runtime_tree_sha256=tree(actual), runtime_file_count=len(actual), executable=evidence['executable'])
    (ai / 'approved-ai-runtime.json').write_text(json.dumps(approval, indent=2) + '\n', encoding='utf8')
    save(reports / 'BACKEND_REBUILD_RESULT.json', {'status': 'ACTUAL_REBUILD_BOUND_PENDING_INSTALLED_INFERENCE',
        'python': actual_python, 'sourceEntrySha256': SOURCE_ENTRY_SHA, 'runtimeTree': tree(actual),
        'runtimeFileCount': len(actual), 'linkedInputCount': len(linked), 'tarInputCount': len(missing),
        'changed': changed, 'releaseAccepted': False, 'fullAiAcceptance': 'NOT_RUN'})


if __name__ == '__main__':
    main()

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
import csv
import io
import marshal
import types
import zipfile

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


def code_fingerprint(code):
    """Compare actual code semantics/positions; only build-root filenames differ."""
    def const(value):
        if isinstance(value, types.CodeType):
            fields = ('co_argcount', 'co_posonlyargcount', 'co_kwonlyargcount', 'co_nlocals',
                      'co_stacksize', 'co_flags', 'co_names', 'co_varnames', 'co_freevars',
                      'co_cellvars', 'co_name', 'co_qualname', 'co_firstlineno')
            return {'kind': 'code', **{name: getattr(value, name) for name in fields},
                    'co_code': value.co_code.hex(), 'co_linetable': value.co_linetable.hex(),
                    'co_exceptiontable': value.co_exceptiontable.hex(),
                    'co_consts': [const(c) for c in value.co_consts]}
        if isinstance(value, bytes):
            return {'kind': 'bytes', 'value': value.hex()}
        if isinstance(value, tuple):
            return {'kind': 'tuple', 'value': [const(c) for c in value]}
        if isinstance(value, frozenset):
            return {'kind': 'frozenset', 'value': sorted((const(c) for c in value),
                    key=lambda c: json.dumps(c, sort_keys=True))}
        assert value is None or value is Ellipsis or isinstance(value, (str, int, float, complex, bool))
        return {'kind': type(value).__name__, 'value': repr(value)}
    return hashlib.sha256(json.dumps(const(code), sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def verify_new_program(old_exe, new_exe, source_entry, reports):
    """Prove no new native bootloader or Python dependency code slipped in."""
    import pefile
    from PyInstaller.archive.readers import CArchiveReader
    def pe_identity(file):
        pe = pefile.PE(str(file))
        try:
            imports = sorted((entry.dll.decode().lower(), sorted(
                item.name.decode() if item.name else '#'+str(item.ordinal) for item in entry.imports))
                for entry in getattr(pe, 'DIRECTORY_ENTRY_IMPORT', []))
            code = [(section.Name.rstrip(b'\0').decode(), hashlib.sha256(section.get_data()).hexdigest())
                    for section in pe.sections if section.Characteristics & 0x20]
            return {'machine': pe.FILE_HEADER.Machine, 'magic': pe.OPTIONAL_HEADER.Magic,
                    'imports': imports, 'codeSections': code}
        finally:
            pe.close()
    old_native, new_native = pe_identity(old_exe), pe_identity(new_exe)
    save(reports / 'BACKEND_NATIVE_BOOTLOADER_PROOF.json', {'old': old_native,
        'new': new_native, 'same': old_native == new_native})
    assert old_native == new_native, 'NEW_NATIVE_BOOTLOADER_OR_IMPORTS_REVIEW_REQUIRED'
    old, new = CArchiveReader(str(old_exe)), CArchiveReader(str(new_exe))
    assert set(old.toc) == set(new.toc) and sorted(old.options) == sorted(new.options), 'EMBEDDED_PROGRAM_MEMBERS_CHANGED'
    compared, changed = [], []
    for name in sorted(new.toc):
        kind = new.toc[name][-1]
        assert kind == old.toc[name][-1]
        if kind == 'z':
            a, b = old.open_embedded_archive(name), new.open_embedded_archive(name)
            assert set(a.toc) == set(b.toc), 'PYZ_MODULE_SET_CHANGED'
            for module in sorted(b.toc):
                ca, cb = a.extract(module), b.extract(module)
                same = code_fingerprint(ca) == code_fingerprint(cb)
                compared.append(module)
                if not same:
                    changed.append('PYZ:' + module)
        elif kind in ('s', 'm', 'M'):
            ca, cb = marshal.loads(old.extract(name)), marshal.loads(new.extract(name))
            same = code_fingerprint(ca) == code_fingerprint(cb)
            if name == 'inference_server_onnx':
                expected = compile(source_entry.read_text(encoding='utf8-sig'), str(source_entry), 'exec',
                                   dont_inherit=True, optimize=0)
                assert code_fingerprint(cb) == code_fingerprint(expected), 'COMPILED_ENTRY_IS_NOT_CURRENT_SOURCE'
                assert not same, 'REBUILT_ENTRY_DID_NOT_CHANGE'
            elif not same:
                changed.append(name)
        else:
            assert old.extract(name) == new.extract(name), 'OTHER_EMBEDDED_MEMBER_CHANGED:' + name
    save(reports / 'BACKEND_PYTHON_PROGRAM_PROOF.json', {'comparedPyzModules': len(compared),
        'otherChangedCode': changed, 'allowedEntry': 'inference_server_onnx',
        'entryBoundToCurrentSource': True, 'ignoredField': 'co_filename only'})
    assert not changed, 'DEPENDENCY_PYTHON_CODE_CHANGED_REVIEW_REQUIRED'


def retain_verified_native_closure(before, desired, locations, runtime, reports):
    """Keep approved DLLs; never redistribute libraries discovered in host tools."""
    decisions = []
    def host_dll(name):
        leaf = name.removeprefix('_internal/').lower()
        return '/' not in leaf and (leaf.startswith('api-ms-win-') or leaf in {
            'msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll',
            'ucrtbase.dll', 'sqlite3.dll'})
    for name in sorted(set(desired) | set(before)):
        if name not in desired:
            raise AssertionError('MISSING_FROZEN_CLOSURE_MEMBER:' + name)
        if name not in before:
            assert host_dll(name) and name.removeprefix('_internal/').lower().startswith('api-ms-win-'), 'NEW_NON_HOST_CLOSURE_MEMBER'
            decisions.append({'path': name, 'action': 'exclude-new-host-api-stub',
                              'discovered': desired.pop(name), 'origin': str(locations.pop(name))})
            continue
        if desired[name] == before[name] or name in ('ai-service.exe', '_internal/base_library.zip'):
            continue
        if name.endswith('.dist-info/RECORD'):
            def record(file):
                return {row[0]: row[1:] for row in csv.reader(io.StringIO(file.read_text(encoding='utf8'))) if row}
            a, b = record(safe(runtime, name)), record(locations[name])
            differences = [key for key in sorted(set(a) | set(b)) if a.get(key) != b.get(key)]
            assert differences and all('/scripts/' in key.replace('\\', '/').lower()
                and key.lower().endswith('.exe') for key in differences), 'WHEEL_RECORD_NON_LAUNCHER_CHANGE'
            decisions.append({'path': name, 'action': 'retain-base-metadata',
                              'recordDifferences': differences, 'reason': 'unpackaged pip launchers embed build environment paths'})
        else:
            assert host_dll(name), 'NEW_OR_CHANGED_PRODUCT_NATIVE_CODE:' + name
            decisions.append({'path': name, 'action': 'retain-base-native-bytes',
                              'discardedHostOrigin': str(locations[name]), 'retained': before[name]})
        desired[name] = before[name]
        locations[name] = safe(runtime, name)
    save(reports / 'BACKEND_RETAINED_CLOSURE_DECISIONS.json', {'decisions': decisions,
        'qualification': 'Old PE import graph retained; bootloader and every dependency Python module must match; installed AI still required'})
    return decisions


def verify_external_stdlib(old_zip, new_zip, reports):
    compared, cache_headers = [], []
    with zipfile.ZipFile(old_zip) as old, zipfile.ZipFile(new_zip) as new:
        assert len(set(old.namelist())) == len(old.namelist())
        assert len(set(new.namelist())) == len(new.namelist())
        assert set(old.namelist()) == set(new.namelist()), 'STDLIB_ZIP_MEMBERS_CHANGED'
        for name in sorted(new.namelist()):
            a, b = old.read(name), new.read(name)
            if name.endswith('.pyc'):
                assert len(a) > 16 and len(b) > 16
                assert a[:4] == b[:4] == importlib.util.MAGIC_NUMBER, 'STDLIB_PYC_MAGIC_CHANGED'
                assert a[4:8] == b[4:8], 'STDLIB_PYC_MODE_CHANGED'
                assert code_fingerprint(marshal.loads(a[16:])) == code_fingerprint(marshal.loads(b[16:])), 'STDLIB_CODE_CHANGED:' + name
                if a[8:16] != b[8:16]:
                    cache_headers.append(name)
            else:
                assert a == b, 'STDLIB_NON_CODE_DATA_CHANGED:' + name
            compared.append(name)
    save(reports / 'BACKEND_EXTERNAL_STDLIB_PROOF.json', {'status': 'PASS',
        'oldSha256': sha(old_zip), 'newSha256': sha(new_zip), 'comparedMembers': compared,
        'sameCodeIgnoringOnlyFilename': True, 'pycCacheHeaderDifferences': cache_headers,
        'cacheHeadersNotUsedToExcuseCodeChanges': True})


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
    env['PATH'] = os.pathsep.join([str(runtime / '_internal'), str(Path(sys.executable).parent),
        sys.base_prefix, str(Path(sys.base_prefix) / 'DLLs'),
        str(Path(os.environ['SystemRoot']) / 'System32'), os.environ['SystemRoot']])
    env['HF_HUB_OFFLINE'] = '1'
    env['TRANSFORMERS_OFFLINE'] = '1'
    command = [sys.executable, '-B', '-m', 'PyInstaller', '--clean', '--noconfirm',
        '--distpath', str(work / 'dist'), '--workpath', str(work / 'analysis'), str(ai / 'build_exe_reuse.spec')]
    with (reports / 'BACKEND_COMPILE.log').open('wb') as log:
        subprocess.run(command, cwd=ai, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=900, check=True)
    # EXE(exclude_binaries=True) in this fixed no-COLLECT spec resolves into
    # WORKPATH, as the actual first cloud compile log records. DISTPATH's
    # informational success line does not imply an EXE exists there.
    executable = work / 'analysis/build_exe_reuse/ai-service.exe'
    shutil.copyfile(closure, reports / 'BACKEND_ACTUAL_CLOSURE.json')
    save(reports / 'BACKEND_EXECUTABLE_RESOLUTION.json', {
        'pathRelativeToBuildWork': executable.relative_to(work).as_posix(),
        'exists': executable.is_file(), 'compileLogSha256': sha(reports / 'BACKEND_COMPILE.log')})
    assert executable.is_file() and sha(ai / 'scripts/inference_server_onnx.py') == SOURCE_ENTRY_SHA
    verify_new_program(runtime / 'ai-service.exe', executable, ai / 'scripts/inference_server_onnx.py', reports)
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
    verify_external_stdlib(runtime / '_internal/base_library.zip', locations['_internal/base_library.zip'], reports)
    added, removed = sorted(desired.keys() - before.keys()), sorted(before.keys() - desired.keys())
    changed = sorted(name for name in desired.keys() & before.keys() if desired[name] != before[name])
    comparison = {'added': added, 'removed': removed, 'changed': changed,
        'sameCount': sum(desired.get(name) == row for name, row in before.items()), 'closureSha256': sha(closure)}
    save(reports / 'BACKEND_ACTUAL_CLOSURE_COMPARISON.json', comparison)
    decisions = retain_verified_native_closure(before, desired, locations, runtime, reports)
    added, removed = sorted(desired.keys() - before.keys()), sorted(before.keys() - desired.keys())
    changed = sorted(name for name in desired.keys() & before.keys() if desired[name] != before[name])
    save(reports / 'BACKEND_ASSEMBLED_CLOSURE_COMPARISON.json', {'added': added, 'removed': removed,
        'changed': changed, 'retainedDecisionCount': len(decisions), 'rawAnalysisComparisonPreserved': True})
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
    evidence['incrementalAssembly']['retainedClosureDecisionsSha256'] = sha(reports / 'BACKEND_RETAINED_CLOSURE_DECISIONS.json')
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

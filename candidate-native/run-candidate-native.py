"""Build on an isolated runner and hand the resulting package to the upgrade test."""

import hashlib
from importlib import import_module, util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
from zipfile import ZipFile


native = import_module('cloud-baseline')
BUDGET = 5 * 1024**3
BRANCH = 'refs/heads/verify-native-candidate'


def read(path):
    return json.loads(path.read_bytes())


def sha(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle,'sha256').hexdigest()


def verify_footprint(roots, reserve=0):
    identities = set()
    total = 0
    for root in roots:
        for folder, dirs, files in os.walk(root,followlinks=False):
            dirs[:] = [name for name in dirs if not (Path(folder)/name).is_junction()]
            for name in files:
                file = Path(folder)/name
                if file.is_symlink():
                    continue
                stat = file.stat()
                identity = (stat.st_dev,stat.st_ino)
                if identity not in identities:
                    identities.add(identity)
                    total += stat.st_size
    assert total + reserve <= BUDGET, 'FIVE_GIB_WORK_BUDGET'
    return total


def stage_windows_tools(controls, work, env):
    archives = work/'tool-archives'
    archives.mkdir()
    subprocess.run(['node',controls/'prefetch-win-tools.cjs',archives],env=env,check=True,timeout=150)
    seven = work/'7za.exe'
    with tarfile.open(archives/'7zip-win-x64.tar.gz','r:gz') as source:
        members = [row for row in source.getmembers() if row.isfile() and PurePosixPath(row.name).name == '7za.exe']
        assert len(members) == 1 and members[0].size == 849920
        with source.extractfile(members[0]) as reader, seven.open('xb') as writer:
            shutil.copyfileobj(reader,writer)
    assert sha(seven) == '223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3'
    env['ELECTRON_BUILDER_7ZIP_PATH'] = str(seven)
    for name,key,entry in (('nsis-3.0.4.1','ELECTRON_BUILDER_NSIS_DIR','Bin/makensis.exe'),
                           ('nsis-resources-3.4.1','ELECTRON_BUILDER_NSIS_RESOURCES_DIR','plugins')):
        target = work/name
        target.mkdir()
        subprocess.run([seven,'x','-t7z','-y','-bd','-bb0',f'-o{target}',archives/(name+'.7z')],
                       env=env,check=True,timeout=60)
        assert (target/entry).exists()
        env[key] = str(target)


def fetch_legacy(controls, packages, platform, legacy, env):
    archive = packages/'legacy-artifact.zip'
    artifact = read(controls/'BASE20_ARTIFACTS.json')[platform]
    subprocess.run(['node',controls/'fetch-base.mjs',platform,archive],check=True,timeout=540,
                   env={**env,'GH_TOKEN':os.environ['GH_TOKEN']})
    assert archive.stat().st_size == artifact['bytes'] and sha(archive) == artifact['sha256']
    cipher, manifest = packages/'legacy-package.enc',packages/'LEGACY_PACKAGE_READY.json'
    with ZipFile(archive) as compressed:
        assert sorted(compressed.namelist()) == ['PACKAGE_READY.json','package.enc']
        assert compressed.getinfo('PACKAGE_READY.json').file_size < 16_384
        assert compressed.getinfo('package.enc').file_size <= artifact['bytes']
        manifest.write_bytes(compressed.read('PACKAGE_READY.json'))
        with compressed.open('package.enc') as reader, cipher.open('xb') as writer:
            shutil.copyfileobj(reader,writer)
    archive.unlink()
    subprocess.run(['node',controls/'transport.cjs','decrypt','--id','pkg','--input',cipher,'--output',legacy,
                    '--manifest',manifest],check=True,timeout=240,
                   env={**env,'OMC_PREVIEW15_TRANSPORT_KEY':os.environ['OMC_PREVIEW15_TRANSPORT_KEY']})
    assert (legacy.stat().st_size,sha(legacy)) == native.LEGACY[sys.platform][:2]
    cipher.unlink()


def package_candidate(build, platform, version, source_tree):
    reports = build/'reports'
    result = read(reports/'BUILD_RESULT.json')
    assert result['version'] == version
    if platform == 'windows':
        assert result['status'] == 'PASS_BUILD_PENDING_INSTALL_AI_UPGRADE'
        package_record = read(reports/'PACKAGE_INPUTS.json')
        assert package_record['baselineSourceTree'] == package_record['derivedSourceTree'] == source_tree
        current = package_record['current']
        assert current == result['current'] and current['version'] == version
        payload = read(reports/'FINAL_APP_MEMBERS.json')
        payload_asar = next(row['sha256'] for row in payload if row['path'] == 'resources/app.asar')
    else:
        assert result['status'] == 'PASS_INCREMENTAL_BUILD_PENDING_INSTALL' and result['sourceTree'] == source_tree
        assert result['expectedPayload'] == 'EXPECTED_PAYLOAD.json'
        current = {**result['package'], 'asarSha256':result['asarSha256']}
        payload = read(reports/result['expectedPayload'])
        payload_asar = payload['Contents/Resources/app.asar']['sha256']
    package = Path(current['path']).resolve(strict=True)
    assert package.is_relative_to(build) and package.suffix == ('.exe' if platform == 'windows' else '.pkg')
    assert package.stat().st_size == current['bytes'] and sha(package) == current['sha256']
    assert current['asarSha256'] == payload_asar and re.fullmatch('[a-f0-9]{64}',payload_asar)
    return package, {**{key:current[key] for key in ('bytes','sha256','asarSha256')},'sourceTree':source_tree}, payload


def installed_payload_verifier(platform, payload, controls, reports):
    if platform == 'windows':
        def verify(executable):
            root = executable.parent.resolve(strict=True)
            for row in payload:
                relative = PurePosixPath(row['path'])
                assert not relative.is_absolute() and '..' not in relative.parts and '\\' not in row['path']
                target = (root/Path(*relative.parts)).resolve(strict=True)
                assert target.is_relative_to(root) and target.is_file() and target.stat().st_size == row['bytes']
                assert sha(target) == row['sha256'], row['path']
            return {'verifiedFiles':len(payload),'installedPayloadMatched':True}
        return verify
    sys.path.insert(0,str(controls))
    try:
        adapter = import_module('pkg_contract_adapter')
        assert Path(adapter.__file__).resolve() == (controls/'pkg_contract_adapter.py').resolve()
        spec = util.spec_from_file_location('candidate_mac_builder',controls/'build-mac.py')
        builder = util.module_from_spec(spec)
        spec.loader.exec_module(builder)
    finally:
        sys.path.pop(0)

    def verify(executable):
        installed = executable.parents[2]
        adapter.verify_installed_payload(None,installed,
            lambda path: payload if path is None else builder.inventory(path),reports)
        subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',installed],check=True,timeout=120)
        return {'verifiedMembers':len(payload),'installedPayloadMatched':True,'adHocSignatureVerified':True}
    return verify


def exercise_packages(work, packages, platform, legacy_package, candidate, candidate_entry, verify_payload):
    # The staged inputs and build output share a volume. Move the verified candidate
    # next to the frozen installer so the harness can reuse both without copying.
    assert candidate.parent != packages and legacy_package.parent == packages
    target = packages/candidate.name
    assert not target.exists()
    candidate.rename(target)
    legacy_bytes, legacy_hash, legacy_asar = native.LEGACY[sys.platform]
    manifest = {'schema':'omc-native-upgrade-input-v1','platform':sys.platform,
                'legacy':{'name':legacy_package.name,'bytes':legacy_bytes,'sha256':legacy_hash,'asarSha256':legacy_asar},
                'candidate':{'name':target.name,**candidate_entry}}
    manifest_path = packages/'UPGRADE.json'
    with manifest_path.open('x',encoding='utf-8') as stream:
        json.dump(manifest,stream)
    assert platform == ('windows' if native.WIN else 'mac')
    native.run_upgrade(work,native.read_upgrade_installers(manifest_path,packages),verify_payload)


def main():
    assert len(sys.argv) == 3
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
    assert os.environ.get('GITHUB_REPOSITORY') == 'Siiiiimon123/OMC-build-checks' and os.environ.get('GITHUB_REF') == BRANCH
    assert native.WIN or native.MAC
    platform = 'windows' if native.WIN else 'mac'
    root = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    inputs = Path(sys.argv[1]).resolve(strict=True)
    assert inputs.is_relative_to(root) and inputs != root
    assert shutil.disk_usage(root).free >= BUDGET
    assert not (native.APP.parent.exists() if native.WIN else Path('/Applications/OMC-Preview.app').exists())
    source, controls, builder_inputs = (inputs/name for name in ('source','controls','builder-inputs'))
    packages = inputs/'packages'
    suffix = '.exe' if native.WIN else '.pkg'
    base, legacy = packages/('base'+suffix),packages/('legacy'+suffix)
    plan_path = controls/'BUILD_CONTROLS.json'
    assert sha(plan_path) == sys.argv[2]
    plan = read(plan_path)
    assert plan['runnerRef'] == BRANCH
    staged = read(inputs/'STAGED.json')
    assert staged['platform'] == platform and staged['buildControlSha256'] == sys.argv[2]
    selected = plan['basePackages'][platform]
    assert (selected['bytes'],selected['sha256']) == native.SPECS[sys.platform][1:]
    assert selected['asarSha256'] == native.ASAR[sys.platform]
    for name,digest in plan['controlSha256'].items():
        assert Path(name).name == name and sha(controls/name) == digest
    source_tree, version = plan['sourceTrees'][platform],plan['testVersion']
    source_manifest = read(builder_inputs/'source19-records.json')
    assert (source_manifest['sourceTree'],source_manifest['version']) == (source_tree,version)
    assert (source_tree,version) == (staged['candidateSourceTree'],staged['version'])
    assert not base.exists() and not legacy.exists()
    base_name = native.SPECS[sys.platform][0]
    native.download(f"https://omc.xiaoa.cyou/updates/targets/releases/{selected['sha256']}.{base_name}",
                    base,selected['bytes'],selected['sha256'])
    work = root/'omc-native-candidate'
    work.mkdir()
    build, usage = work/'build',work/'usage'
    usage.mkdir()
    clean = {key:value for key,value in os.environ.items() if key not in
             ('GH_TOKEN','GITHUB_TOKEN','OMC_PREVIEW15_TRANSPORT_KEY') and key.lower() != 'psmodulepath'}
    clean.update(ELECTRON_SKIP_BINARY_DOWNLOAD='1',PYTHONDONTWRITEBYTECODE='1',CSC_IDENTITY_AUTO_DISCOVERY='false')
    npm = 'npm.cmd' if native.WIN else 'npm'
    subprocess.run([npm,'ci','--ignore-scripts','--no-audit','--no-fund'],cwd=source,env=clean,check=True,timeout=600)
    verify_footprint([inputs,work])
    if native.WIN:
        stage_windows_tools(controls,work,clean)
        command = ['node',controls/'build-windows.cjs','--source',source,'--base',base,'--inputs',builder_inputs,'--work',build]
    else:
        command = [sys.executable,controls/'build-mac.py',source,base,builder_inputs,build]
    subprocess.run(command,cwd=source,env=clean,check=True,timeout=1800)
    package, entry, payload = package_candidate(build,platform,version,source_tree)
    verify_footprint([inputs,work])
    if native.WIN:
        for name in ('fullApp','asar-input'):
            folder = build/name
            assert folder.resolve(strict=True) == folder and folder.parent == build and not folder.is_junction()
            shutil.rmtree(folder)
        (build/'new-app.asar').unlink()
    # The base is the verified published installer, staged solely for this build.
    assert base.resolve(strict=True) == base and base.parent == packages
    base.unlink()
    legacy_bytes = native.LEGACY[sys.platform][0]
    verify_footprint([inputs,work],2*legacy_bytes+1024*1024)
    fetch_legacy(controls,packages,platform,legacy,clean)
    file_members = payload if native.WIN else (row for row in payload.values() if row['kind'] == 'file')
    verify_footprint([inputs,work],sum(row['bytes'] for row in file_members))
    verify_payload = installed_payload_verifier(platform,payload,controls,build/'reports')

    def verify_and_budget(executable):
        installed = executable.parent if native.WIN else executable.parents[2]
        verified = verify_payload(executable)
        return {**verified,'workingBytes':verify_footprint([inputs,work,installed])}

    exercise_packages(usage,packages,platform,legacy,package,entry,verify_and_budget)


if __name__ == '__main__':
    main()

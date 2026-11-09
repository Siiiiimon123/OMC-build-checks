"""Disposable GitHub runners. Build from the authenticated Preview.23 baselines."""
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import traceback
import zipfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WORK = Path(os.environ["RUNNER_TEMP"]).resolve() / "omc-update24"
WIN = sys.platform == "win32"
MODE = "windows" if WIN else "mac"
VERSION = "1.0.21-preview.24"
BRANCH = "refs/heads/verify-update24"
BUDGET = 5 * 1024**3
KEY = "OMC_PREVIEW15_TRANSPORT_KEY"

def read(p):
    return json.loads(Path(p).read_text(encoding="utf-8-sig"))

def save(p, value):
    Path(p).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")

def sha(p):
    with Path(p).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def native_path(name):
    p = PurePosixPath(name)
    assert not p.is_absolute() and '..' not in p.parts and '\\' not in name and ':' not in name
    return Path(*p.parts)

def unzip(file, dest, limit):
    dest.mkdir()
    with zipfile.ZipFile(file) as z:
        entries = z.infolist()
        assert len({i.filename.lower() for i in entries}) == len(entries)
        assert sum(i.file_size for i in entries) <= limit
        for entry in entries:
            assert not entry.is_dir() and (entry.external_attr >> 16) & 0o170000 != 0o120000
            target = dest / native_path(entry.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(entry) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output, 1024 * 1024)

def owned_remove(directory):
    assert not directory.is_symlink() and directory.resolve().is_relative_to(WORK)
    shutil.rmtree(directory)

def footprint(roots):
    seen = set()
    total = 0
    for root in roots:
        for folder, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = [d for d in dirs if not (Path(folder) / d).is_symlink()]
            for name in files:
                p = Path(folder) / name
                if p.is_symlink():
                    continue
                s = p.stat()
                identity = (s.st_dev, s.st_ino)
                if identity not in seen:
                    seen.add(identity)
                    total += s.st_size
    return total

def raw(relative):
    return subprocess.check_output(['git','show','HEAD:' + relative], cwd=REPO)

def adapted(relative, dest, changes=()):
    source = raw(relative).decode('utf-8')
    for before, after in changes:
        assert before in source, "ADAPTER_INPUT_NOT_FOUND:" + relative
        source = source.replace(before, after)
    dest.write_text(source, encoding='utf-8', newline='\n')

def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('GITHUB_REPOSITORY') == 'Siiiiimon123/OMC-build-checks'
    assert os.environ.get('GITHUB_REF') == BRANCH and os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
    assert WIN or sys.platform == 'darwin'
    WORK.mkdir()
    evidence = WORK / 'evidence'; evidence.mkdir()
    encrypted = WORK / 'encrypted'; encrypted.mkdir()
    controls = WORK / 'controls'; controls.mkdir()
    spec = read(HERE / 'INPUT.json')
    scope = spec['scopes'][MODE]
    base_info = read(HERE / 'BASE20_ARTIFACTS.json')[MODE]
    clean = {k:v for k,v in os.environ.items() if k not in (KEY,'GH_TOKEN','GITHUB_TOKEN') and k.lower() != 'psmodulepath'}
    clean.update(ELECTRON_SKIP_BINARY_DOWNLOAD='1', PYTHONDONTWRITEBYTECODE='1')
    transport = WORK / 'transport.cjs'
    transport.write_bytes(raw('final19/transport.cjs'))
    assert sha(transport) == '19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f'
    result = {'status':'RUNNING','version':VERSION,'platform':MODE,'sourceTree':scope['after'],
        'baseSourceTree':scope['before'],'controlCommit':os.environ['GITHUB_SHA'],'nativeInstallation':False,
        'productionEndpointUsed':False,'backendRebuilt':False}
    source = WORK / 'source'
    installed = None
    package = None

    def run(label, args, cwd=WORK, timeout=600, env=clean, require=True):
        print(json.dumps({'phase':label}), flush=True)
        log = evidence / (label + '.log')
        with log.open('xb') as stream:
            proc = subprocess.run(list(map(str,args)),cwd=cwd,env=env,timeout=timeout,stdout=stream,stderr=subprocess.STDOUT)
        if require:
            assert proc.returncode == 0, label + '_FAILED'
        return proc.returncode

    def decrypt(label, manifest, artifact, output):
        run('decrypt-'+label,['node',transport,'decrypt','--manifest',manifest,'--id',label,'--input',artifact,'--output',output],
            env={**clean, KEY:os.environ[KEY]})

    def budget(label, reserve=0):
        n = footprint([WORK] + ([installed] if installed else []))
        save(evidence/('SPACE_'+label+'.json'),{'bytes':n,'reserve':reserve,'limit':BUDGET})
        assert n + reserve <= BUDGET, 'FIVE_GIB_WORK_BUDGET'

    def patch_zip(z, dest):
        rows = json.loads(z.read('PATCH.json'))
        assert set(z.namelist()) == {'PATCH.json', *(r['path'] for r in rows)}
        for row in rows:
            p = dest / native_path(row['path'])
            assert (not p.exists()) if row['beforeSha256'] is None else sha(p) == row['beforeSha256']
            b = z.read(row['path'])
            assert hashlib.sha256(b).hexdigest() == row['sha256']
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b)

    try:
        run('read-only-public-endpoint',['node','-e',
            "fetch('https://omc.xiaoa.cyou/updates/metadata/timestamp.json',{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(8000)}).then(r=>console.log(JSON.stringify({status:r.status,server:r.headers.get('server')}))).catch(e=>console.log(JSON.stringify({error:e.cause?.code??e.name})))"],timeout=15)
        old = REPO / 'opt20'
        with (WORK/'base-source.enc').open('xb') as output:
            for i in range(14):
                output.write(raw('opt20/source.part%02d.enc' % i))
        decrypt('source-r20',old/'source.transport.json',WORK/'base-source.enc',WORK/'base-source.zip')
        unzip(WORK/'base-source.zip',source,16*1024**2)
        (WORK/'previous-overlay.enc').write_bytes(base64.b64decode(raw('opt20/overlay.b64').strip(),validate=True))
        decrypt('r20-overlay',old/'overlay.transport.json',WORK/'previous-overlay.enc',WORK/'previous-overlay.zip')
        with zipfile.ZipFile(WORK/'previous-overlay.zip') as z:
            patch_zip(z,source)
        native = REPO/'native23'
        (WORK/'helpers.enc').write_bytes(base64.b64decode(raw('native23/helpers.b64').strip(),validate=True))
        decrypt('native23-helpers',native/'HELPERS.transport.json',WORK/'helpers.enc',WORK/'helpers.zip')
        inputs = WORK/'inputs'
        unzip(WORK/'helpers.zip',inputs,2*1024**2)
        stage = spec['sourceInputDirectory']
        metadata = read(REPO/stage/'CURRENT_SOURCE_INPUT.json')
        (WORK/'current.enc').write_bytes(b''.join(base64.b64decode(raw(stage+'/current-source.part%d.b64'%i).strip(),validate=True)
                                                for i in range(metadata['parts'])))
        decrypt('current-source-checks',REPO/stage/'CURRENT_SOURCE.transport.json',WORK/'current.enc',WORK/'current.zip')
        delta = WORK/'delta'
        unzip(WORK/'current.zip',delta,2*1024**2)
        baseline = read(delta/'BASELINE.json')
        assert baseline['sourceTree'] == '883787ae0ea60c56d348ff758fa150fb3f40007d'
        for row in baseline['records']:
            assert sha(source/native_path(row['path'])) == row['sha256']
        old_candidate = read(inputs/'WINDOWS_SOURCE_RECORDS.json' if WIN else delta/'CANDIDATE.json')
        assert old_candidate['sourceTree'] == scope['before']
        by = {r['path']:r for r in old_candidate['records']}
        for row in read(delta/'PATCH.json'):
            if row['path'] not in by or by[row['path']]['sha256'] != row['sha256']:
                continue
            p = source/native_path(row['path'])
            assert (not p.exists()) if row['beforeSha256'] is None else sha(p) == row['beforeSha256']
            p.parent.mkdir(parents=True,exist_ok=True)
            p.write_bytes((delta/native_path(row['path'])).read_bytes())
        assert {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()} == set(by)
        assert all(sha(source/native_path(r['path'])) == r['sha256'] for r in by.values())
        (WORK/'overlay24.enc').write_bytes(base64.b64decode(raw('update24/overlay24.b64').strip(),validate=True))
        decrypt('update24-source',HERE/'OVERLAY.json',WORK/'overlay24.enc',WORK/'overlay24.gz')
        with gzip.open(WORK/'overlay24.gz','rb') as z:
            overlay = json.loads(z.read(768*1024))
        rows = overlay['changesByPlatform'][MODE]
        assert len(rows) == 10 and len({r['path'] for r in rows}) == 10
        for row in rows:
            name = row['path']
            p = source / native_path(name)
            assert by.get(name, {}).get('sha256') == row['beforeSha256']
            b = base64.b64decode(overlay['changes'][name]['data'],validate=True)
            assert len(b) == row['bytes'] and hashlib.sha256(b).hexdigest() == row['sha256']
            p.write_bytes(b)
            by[name] = {k:v for k,v in row.items() if k != 'beforeSha256'}
        assert len(by) == scope['files'] and read(source/'package.json')['version'] == VERSION
        save(inputs/'source19-records.json',{'sourceTree':scope['after'],'records':list(by.values())})
        origin = read(inputs/('runtime-origin-source.json' if WIN else 'MAC_BACKEND_SOURCE_RECORDS.json'))
        ai = lambda records: {r['path']:r['sha256'] for r in records if r['path'].startswith('ai-training/')}
        assert ai(origin['records']) == ai(by.values())
        save(evidence/'SOURCE_AND_BACKEND.json',{'sourceTree':scope['after'],'before':scope['before'],'aiInputCount':len(ai(by.values()))})

        npm = 'npm.cmd' if WIN else 'npm'
        run('locked-build-dependencies',[npm,'ci','--ignore-scripts','--no-audit','--no-fund'],source)
        run('update-source-regressions',['node','--test','electron/strictTufFetcher.test.cjs','electron/updateArtifactTransfer.test.cjs',
            'electron/updateService.test.cjs','src/services/updateUiState.test.js','src/services/updateTrustContract.test.js'],source)
        run('core-regressions',[npm,'run','test:core'],source)

        branch = ('refs/heads/verify-optimization20', BRANCH)
        old_version = ('1.0.21-preview.23', VERSION)
        for name in ('contracts.cjs','bootstrap.cjs','provision-subject-model.cjs','verify-mac-entry.cjs','cloud-shortcut-launch.mjs'):
            adapted('native23/'+name, controls/name)
        for name in ('pkg_contract_adapter.py','contracts.cjs','bootstrap.cjs'):
            if (inputs/name).is_file():
                shutil.copyfile(inputs/name, controls/name)
        shutil.copyfile(HERE/'BASE20_ARTIFACTS.json',controls/'BASE20_ARTIFACTS.json')
        adapted('native23/fetch-base.mjs',controls/'fetch-base.mjs',[branch])
        artifact = WORK/'baseline.zip'
        run('fetch-accepted-preview23',['node',controls/'fetch-base.mjs',MODE,artifact],
            timeout=600,env={**clean,'GH_TOKEN':os.environ['GH_TOKEN']})
        frozen = WORK/'baseline-download'
        unzip(artifact,frozen,1100*1024**2)
        assert {p.name for p in frozen.iterdir()} == {'PACKAGE_READY.json','package.enc'}
        base = WORK/('baseline.exe' if WIN else 'baseline.pkg')
        decrypt('pkg',frozen/'PACKAGE_READY.json',frozen/'package.enc',base)
        assert base.stat().st_size == base_info['plainBytes'] and sha(base) == base_info['plainSha256']
        artifact.unlink(); owned_remove(frozen)
        budget('before-build')
        build = WORK/'build'
        if WIN:
            adapted('native23/build-windows.cjs',controls/'build-windows.cjs',[
                branch, old_version, ('1.0.21-preview.21','1.0.21-preview.23'),
                (scope['before'],scope['after']), ('length===945','length==='+str(scope['files'])),
                ('806457221',str(base_info['plainBytes'])),
                ('9dc4195d811683ae66c8b3ca452b16e5d47b0b3c045eda339bc01817e0096a3a',base_info['plainSha256'])])
            run('native-build-windows',['node',controls/'build-windows.cjs','--source',source,'--base',base,
                '--inputs',inputs,'--work',build],source,1800)
            receipt = read(build/'reports/PACKAGE_INPUTS.json')
            package = Path(receipt['current']['path'])
            for name in ('fullApp','asar-input'):
                owned_remove(build/name)
            (build/'new-app.asar').unlink()
            shutil.copyfile(build/'reports/FINAL_APP_MEMBERS.json',inputs/'FINAL_APP_MEMBERS.json')
            shutil.copyfile(build/'reports/PACKAGE_INPUTS.json',inputs/'PACKAGE_INPUTS.json')
            run('native-first-install-windows',['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',
                inputs/'Install-FinalWindows.ps1','-InputsPath',inputs/'PACKAGE_INPUTS.json','-OutputPath',evidence/'FIRST_INSTALL.json'])
            info = read(evidence/'FIRST_INSTALL.json')
            assert info['installedPayloadPassed'] and info['shortcutBindingPassed']
            installed = Path(info['executable']).parent
            installed_asar = installed/'resources/app.asar'
            run('windows-desktop-shortcut',['node',controls/'cloud-shortcut-launch.mjs',evidence/'FIRST_INSTALL.json',WORK/'shortcut',evidence],source)
        else:
            adapted('native23/rebuild-mac-asar.cjs',controls/'rebuild-mac-asar.cjs',[
                old_version, ('1.0.21-preview.22','1.0.21-preview.23'),(scope['before'],scope['after']),
                ('length===946','length==='+str(scope['files'])),('sourceFiles:946','sourceFiles:'+str(scope['files']))])
            adapted('native23/build-mac.py',controls/'build-mac.py',[
                branch, old_version, ("'1.0.21.23'","'1.0.21.24'"),(scope['before'],scope['after']),
                ('986592598',str(base_info['plainBytes'])),
                ('a1ecd40f95fd3da62f4cb8285a6a6c0b3de68032909d51f163654cf9793d1620',base_info['plainSha256']),
                ('matches[0].rename(app)','matches[0].rename(app);shutil.rmtree(expanded)'),
                ("build_nonrelocatable_pkg(app,work,pkg,run,reports)",
                 "shutil.rmtree(work/'asar-input');(work/'current-app.asar').unlink()\n    build_nonrelocatable_pkg(app,work,pkg,run,reports)\n    shutil.rmtree(work/'nonrelocatable-pkg-build')"),
                ('    base.unlink()', '    expected_payload=inventory(app)\n    shutil.rmtree(expanded_final)\n    shutil.rmtree(app)'),
                ('verify_installed_payload(app,installed,inventory,reports)',
                 'verify_installed_payload(app,installed,lambda p: expected_payload if p == app else inventory(p),reports)')])
            run('native-build-and-install-mac',['python',controls/'build-mac.py',source,base,inputs,build],source,1800)
            receipt = read(build/'reports/BUILD_RESULT.json')
            package = Path(receipt['package']['path'])
            installed = Path(receipt['installedApp'])
            installed_asar = installed/'Contents/Resources/app.asar'
            frontend = read(build/'reports/FRONTEND_REBUILD.json')
            run('mac-native-entry',['node',controls/'verify-mac-entry.cjs',source,installed,frontend['asarSha256'],evidence/'MAC_APP_ENTRY.json'],source)
            adapted('isolated23/normal-cdp.mjs',controls/'normal-cdp.mjs')
            shutil.copyfile(HERE/'verify-mac24.mjs',controls/'verify-mac24.mjs')
            run('mac-installed-ui',['node',controls/'verify-mac24.mjs',installed,WORK/'mac-profile',evidence/'MAC_LAUNCH.json'],source)
        result.update(nativeInstallation=True,installerBytes=package.stat().st_size,installerSha256=sha(package),
            installedAsarSha256=sha(installed_asar))
        for name in ('BUILD_RESULT.json','FRONTEND_REBUILD.json','UNCHANGED_RUNTIME_PROOF.json',
                     'BACKEND_REUSE.json','INSTALLED_PAYLOAD_DIFF.json','PACKAGE_INPUTS.json'):
            p = build/'reports'/name
            if p.is_file():
                shutil.copyfile(p,evidence/name)
        budget('before-live-transport',package.stat().st_size)
        tls = WORK/'tls-fixture'; tls.mkdir()
        if WIN:
            git_home = Path(os.environ['ProgramFiles']) / 'Git'
            openssl = next(p for p in (git_home/'mingw64/bin/openssl.exe',git_home/'usr/bin/openssl.exe') if p.is_file())
        else:
            openssl = Path('/usr/bin/openssl')
        run('loopback-tls-key',[openssl,'req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',HERE/'tls-fixture.cnf',
            '-keyout',tls/'fixture.key','-out',tls/'fixture.crt'])
        rc = run('verified-package-transfer',['node',HERE/'verify-transfer24.cjs',source,installed_asar,base,package,tls,
            evidence/'TRANSFER.json'],source,1200,env={**clean,'NODE_EXTRA_CA_CERTS':str(tls/'fixture.crt')},require=False)
        if rc != 0:
            result['transferExitCode'] = rc
            raise AssertionError('TRANSFER_GATE_FAILED')
        assert read(evidence/'TRANSFER.json')['passed']
        result['status'] = 'PASS_NATIVE_PACKAGE_AND_ALL_TRANSFER_PATHS'
    except Exception:
        result['status'] = 'FAIL'
        (evidence/'ERROR.txt').write_text(traceback.format_exc(),encoding='utf-8')
    finally:
        save(evidence/'SUMMARY.json',result)
        reports = WORK/'reports.zip'
        with zipfile.ZipFile(reports,'x',compression=zipfile.ZIP_DEFLATED) as z:
            for p in evidence.rglob('*'):
                if p.is_file():
                    z.write(p,p.relative_to(evidence).as_posix())
        private = {**clean,KEY:os.environ[KEY]}
        run('encrypt-report',['node',transport,'encrypt','--input',reports,'--output',encrypted/'reports.enc',
            '--manifest',encrypted/'REPORTS_READY.json','--id','reports'],env=private)
        if result['nativeInstallation'] and package and package.is_file():
            if (WORK/'tls-fixture').is_dir():
                owned_remove(WORK/'tls-fixture')
            budget('before-encrypted-candidate',package.stat().st_size)
            run('encrypt-candidate',['node',transport,'encrypt','--input',package,'--output',encrypted/'package.enc',
                '--manifest',encrypted/'PACKAGE_READY.json','--id','pkg'],env=private)
    return 0 if result['status'].startswith('PASS_') else 1

if __name__ == '__main__':
    sys.exit(main())

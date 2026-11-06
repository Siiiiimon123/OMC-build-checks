"""Disposable cloud VM: exact frontend-only update, real installation and AI."""
from pathlib import Path, PurePosixPath
import base64, hashlib, json, os, shutil, subprocess, sys, traceback, zipfile
HERE=Path(__file__).resolve().parent
WORK=Path(os.environ['RUNNER_TEMP'])/'omc-native23-windows-completion'
IS_WIN=sys.platform=='win32'
def sha(p):
    with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(p,v):Path(p).write_text(json.dumps(v,indent=2)+'\n',encoding='utf8')
def unzip(file,dest,limit):
    dest.mkdir()
    with zipfile.ZipFile(file) as z:
        assert len({i.filename.lower() for i in z.infolist()})==len(z.infolist())
        assert sum(i.file_size for i in z.infolist())<=limit
        for i in z.infolist():
            p=PurePosixPath(i.filename)
            assert not p.is_absolute() and '..' not in p.parts and '\\' not in i.filename and ':' not in i.filename
            assert not i.is_dir() and (i.external_attr>>16)&0o170000!=0o120000
            target=dest.joinpath(*p.parts);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(i))
def footprint(roots):
    seen=set();total=0
    for root in roots:
        if not root.exists():continue
        for base,dirs,files in os.walk(root,followlinks=False):
            dirs[:]=[d for d in dirs if not (Path(base)/d).is_symlink()]
            for name in files:
                p=Path(base)/name
                if p.is_symlink():continue
                s=p.stat();identity=(s.st_dev,s.st_ino)
                if identity not in seen:seen.add(identity);total+=s.st_size
    return total
def main():
    assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='Siiiiimon123/OMC-build-checks'
    assert os.environ.get('GITHUB_REF')=='refs/heads/verify-optimization20' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
    assert sys.platform=='win32' and not WORK.exists()
    WORK.mkdir();evidence=WORK/'evidence';evidence.mkdir();encrypted=WORK/'encrypted';encrypted.mkdir()
    spec=json.loads((HERE.parent/'native23/INPUT.json').read_bytes());mode='windows' if IS_WIN else 'mac'
    tree=spec['windowsSourceTree' if IS_WIN else 'macSourceTree']
    result={'status':'RUNNING','sourceTree':tree,'controlCommit':os.environ['GITHUB_SHA'],
        'backendRebuilt':False,'published':False,'productionUpgradeTested':False,'version':spec['version']}
    clean={k:v for k,v in os.environ.items() if k not in ('OMC_PREVIEW15_TRANSPORT_KEY','GH_TOKEN','GITHUB_TOKEN') and k.lower()!='psmodulepath'}
    clean.update(ELECTRON_SKIP_BINARY_DOWNLOAD='1',PYTHONDONTWRITEBYTECODE='1')
    stages=[];package=None;installed_root=None;ok=False
    transport=WORK/'transport.cjs'
    transport.write_bytes(subprocess.run(['git','show','HEAD:final19/transport.cjs'],cwd=HERE.parent,check=True,stdout=subprocess.PIPE).stdout)
    assert sha(transport)=='19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f'
    def run(name,args,cwd=WORK,timeout=900,private=False):
        print(json.dumps({'phase':name}),flush=True)
        with (evidence/(name+'.log')).open('xb') as log:
            p=subprocess.run(list(map(str,args)),cwd=cwd,env=os.environ if private else clean,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
        stages.append({'phase':name,'exit':p.returncode});assert p.returncode==0,name+'_FAILED'
    def decrypt(manifest,asset,cipher,out):run('decrypt-'+asset,['node',transport,'decrypt','--manifest',manifest,'--id',asset,'--input',cipher,'--output',out],private=True)
    def budget(name,reserve=0):
        roots=[WORK]+([installed_root] if installed_root else [])
        used=footprint(roots);save(evidence/('SPACE_'+name+'.json'),{'uniqueBytes':used,'reservedBytes':reserve,'limitBytes':5*1024**3})
        assert used+reserve<=5*1024**3,'FIVE_GIB_WORKING_ARTIFACT_BUDGET'
    try:
        old=HERE.parent/'opt20';cipher=WORK/'base.enc'
        with cipher.open('xb') as f:
            for i in range(14):f.write((old/('source.part%02d.enc'%i)).read_bytes())
        decrypt(old/'source.transport.json','source-r20',cipher,WORK/'base.zip')
        source=WORK/'source';unzip(WORK/'base.zip',source,16*1024**2)
        overlay=WORK/'overlay.enc';overlay.write_bytes(base64.b64decode((old/'overlay.b64').read_bytes(),validate=True))
        decrypt(old/'overlay.transport.json','r20-overlay',overlay,WORK/'overlay.zip')
        with zipfile.ZipFile(WORK/'overlay.zip') as z:
            rows=json.loads(z.read('PATCH.json'));assert len(rows)==56
            assert set(z.namelist())=={'PATCH.json',*(r['path'] for r in rows)}
            for r in rows:
                p=PurePosixPath(r['path']);assert not p.is_absolute() and '..' not in p.parts and '\\' not in r['path'] and ':' not in r['path']
                target=source.joinpath(*p.parts)
                assert not target.exists() if r['beforeSha256'] is None else sha(target)==r['beforeSha256']
                data=z.read(r['path']);assert hashlib.sha256(data).hexdigest()==r['sha256']
                target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        hc=WORK/'helpers.enc';hc.write_bytes(base64.b64decode((HERE.parent/'native23/helpers.b64').read_bytes(),validate=True))
        decrypt(HERE.parent/'native23/HELPERS.transport.json','native23-helpers',hc,WORK/'helpers.zip')
        inputs=WORK/'inputs';unzip(WORK/'helpers.zip',inputs,2*1024**2)
        current=HERE.parent/spec['sourceInputDirectory'];cs=json.loads((current/'CURRENT_SOURCE_INPUT.json').read_bytes())
        cc=WORK/'current.enc';cc.write_bytes(b''.join(base64.b64decode((current/('current-source.part%d.b64'%i)).read_bytes(),validate=True) for i in range(cs['parts'])))
        decrypt(current/'CURRENT_SOURCE.transport.json','current-source-checks',cc,WORK/'current.zip')
        delta=WORK/'delta';unzip(WORK/'current.zip',delta,2*1024**2)
        baseline=json.loads((delta/'BASELINE.json').read_bytes())
        assert baseline['sourceTree']=='883787ae0ea60c56d348ff758fa150fb3f40007d'
        for r in baseline['records']:assert sha(source/r['path'])==r['sha256']
        candidate=json.loads((inputs/'WINDOWS_SOURCE_RECORDS.json' if IS_WIN else delta/'CANDIDATE.json').read_bytes())
        assert candidate['sourceTree']==tree
        by={r['path']:r for r in candidate['records']}
        for r in json.loads((delta/'PATCH.json').read_bytes()):
            if r['path'] not in by or by[r['path']]['sha256']!=r['sha256']:continue
            p=PurePosixPath(r['path']);assert not p.is_absolute() and '..' not in p.parts and '\\' not in r['path'] and ':' not in r['path']
            target=source.joinpath(*p.parts)
            assert not target.exists() if r['beforeSha256'] is None else sha(target)==r['beforeSha256']
            data=(delta/r['path']).read_bytes();assert hashlib.sha256(data).hexdigest()==r['sha256']
            target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        assert {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}==set(by)
        for r in candidate['records']:assert sha(source/r['path'])==r['sha256']
        save(inputs/'source19-records.json',candidate)
        origin=json.loads((inputs/('runtime-origin-source.json' if IS_WIN else 'MAC_BACKEND_SOURCE_RECORDS.json')).read_bytes())
        ai=lambda records:{r['path']:r['sha256'] for r in records if r['path'].startswith('ai-training/')}
        assert ai(origin['records'])==ai(candidate['records']) and len(ai(candidate['records']))==(133 if IS_WIN else 134)
        save(evidence/'SOURCE_AND_AI_REUSE.json',{'sourceTree':tree,'backendOriginTree':origin['sourceTree'],'allAiSourceInputsIdentical':True,'aiInputCount':len(ai(candidate['records']))})
        npm='npm.cmd' if IS_WIN else 'npm'
        run('fixed-build-dependencies',[npm,'ci','--ignore-scripts','--no-audit','--no-fund'],source,600)
        save(evidence/'REUSED_SOURCE_CHECKS.json',spec['sourceChecks'])
        # Both exact platform source variants already passed415; no repeat.
        ic=WORK/'install-bindings.enc';ic.write_bytes(base64.b64decode((HERE/'install-bindings.b64').read_bytes(),validate=True))
        decrypt(HERE/'INSTALL.transport.json','native23-install',ic,WORK/'install-bindings.zip')
        bindings=WORK/'install-bindings';unzip(WORK/'install-bindings.zip',bindings,2*1024**2)
        artifact=WORK/'baseline-artifact.zip';run('fetch-exact-platform-package',['node',HERE/'fetch-base.mjs',mode,artifact],timeout=600,private=True)
        frozen=WORK/'frozen';unzip(artifact,frozen,1100*1024**2)
        assert {p.name for p in frozen.iterdir()}=={'PACKAGE_READY.json','package.enc'}
        base=WORK/('baseline.exe' if IS_WIN else 'baseline.pkg')
        decrypt(frozen/'PACKAGE_READY.json','pkg',frozen/'package.enc',base)
        base_info=json.loads((HERE/'BASE20_ARTIFACTS.json').read_bytes())[mode]
        assert base.stat().st_size==base_info['plainBytes'] and sha(base)==base_info['plainSha256']
        artifact.unlink();(frozen/'package.enc').unlink();budget('before-build')
        package=base
        if IS_WIN:
            built=json.loads((bindings/'PACKAGE_INPUTS.json').read_bytes())
            assert built['baselineSourceTree']==tree and built['current']['bytes']==base_info['plainBytes'] and built['current']['sha256']==base_info['plainSha256']
            built['current']['path']=str(package)
            shutil.copyfile(bindings/'FINAL_APP_MEMBERS.json',inputs/'FINAL_APP_MEMBERS.json')
            save(inputs/'PACKAGE_INPUTS.json',built)
            run('pristine-windows-install',['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',inputs/'Install-FinalWindows.ps1','-InputsPath',inputs/'PACKAGE_INPUTS.json','-OutputPath',evidence/'FIRST_INSTALL.json'],timeout=600)
            info=json.loads((evidence/'FIRST_INSTALL.json').read_text(encoding='utf-8-sig'))
            assert info['installedPayloadPassed']
            installed=info['executable'];installed_root=Path(installed).parent
            run('actual-desktop-shortcut-launch',['node',HERE/'cloud-shortcut-launch.mjs',evidence/'FIRST_INSTALL.json',WORK/'shortcut',evidence],source,300)
            native=json.loads((evidence/'ACTUAL_DESKTOP_SHORTCUT_LAUNCH.json').read_bytes())
            assert native['status']=='PASS_ACTUAL_UNICODE_DESKTOP_SHORTCUT_LAUNCH_AND_NATIVE_LINK_READ' and native['normalExitVerified'] and native['originalShortcutUnchanged'] and native['nativeTargetAndIconVerifiedOnIdenticalBytes']
            save(evidence/'SHORTCUT_COMPARISON.json',{'wshPropertyReaderPassed':info['shortcutBindingPassed'],'actualOriginalShortcutShellLaunchPassed':True,'nativeTargetAndIconPassed':True,'shortcutEdited':False})
        else:
            installed_root=Path('/Applications/OMC-Preview.app');assert not installed_root.exists()
            run('install-exact-current-mac',['sudo','/usr/sbin/installer','-pkg',package,'-target','/'],timeout=600)
            run('verify-installed-mac-signature',['/usr/bin/codesign','--verify','--deep','--strict',installed_root])
            run('verify-installed-mac-entry',['node',HERE/'verify-mac-entry.cjs',source,installed_root,'ef535b79281a3df087f90e3439a1bf8f84b5541b8aa96471795bd397252350fd',evidence/'MAC_APP_ENTRY.json'],source)
            installed=installed_root/'Contents/MacOS/OMC-Preview';assert installed.is_file()
            reused=json.loads((bindings/'REUSED_MAC_SUBJECT.json').read_bytes())
            assert reused['packageSha256']==base_info['plainSha256'] and reused['sourceTree']==tree
            assert reused['result']['status']=='PASS_INSTALLED_NORMAL_AI_SUBJECT_CLASSIFICATION_RESTORE_RESTART' and reused['result']['originalsUnchanged']
            save(evidence/'REUSED_NATIVE_SUBJECT.json',reused)
        budget('installed',805306368)
        photos=HERE.parent/'jpeg19-source';photo_inputs=json.loads((photos/'INPUT.json').read_bytes())
        for a in photo_inputs['assets']:
            if a['id'] not in ('sample-a','sample-b'):continue
            target=WORK/(a['id']+'.enc')
            with target.open('xb') as f:
                for p in sorted((photos/'inputs'/a['id']).glob('*.enc')):f.write(p.read_bytes())
            assert target.stat().st_size==a['ciphertextBytes'] and sha(target)==a['ciphertextSha256']
            meta=WORK/(a['id']+'.json');save(meta,{'schema':'omc-aes256gcm-build-transport-v1','assets':[a]})
            decrypt(meta,a['id'],target,WORK/(a['id']+'.jpg'))
        for name,driver,args,timeout in [
            ('normal-subject','cloud-subject-workflow.mjs',[WORK/'sample-a.jpg',WORK/'sample-b.jpg',installed,tree],1200),
            ('real-jpeg','cloud-final-installed.mjs',[WORK/'sample-b.jpg',installed],900),
            ('synthetic-group','cloud-final-installed.mjs',['',installed],900),
            ('normal-thousand','cloud-project-endurance.mjs',[WORK/'sample-a.jpg',WORK/'sample-b.jpg',installed,tree],1800)]:
            if name=='normal-subject' and not IS_WIN:continue
            budget('before-'+name,805306368)
            case=WORK/name;case.mkdir();run('installed-'+name,['node',HERE/driver,source,case,*args],source,timeout)
            file='JPEG_FUNCTIONAL.json' if name in ('real-jpeg','synthetic-group') else 'PROJECT_ENDURANCE.json'
            measured=json.loads((case/'evidence'/file).read_bytes())
            assert measured['status'].startswith('PASS_') and measured.get('originalUnchanged',measured.get('originalsUnchanged'))
            if name=='synthetic-group':
                assert measured['finishedFlow']['group']['realCandidateGroup'] and measured['finishedFlow']['group']['selectionAndDecisionPreserved']
                assert len(measured['finishedFlow']['exported'])==2
            if name=='normal-thousand':
                assert measured['status']=='PASS_INSTALLED_NORMAL_PROJECT_1000_IMPORT_AI_RESTART'
                assert measured['automaticReview']['severeSubjectControlsPassed']==3 and measured['automaticReview']['clearOriginalsPreserved']==2
                result.update(importObservedMs=measured['importObservedMs'],analysisObservedMs=measured['analysisObservedMs'],runtimeRoute=measured.get('runtimeRoute'))
        result.update(status='PASS_EXACT_NATIVE23_INSTALL_AI_SUBJECT_JPEG_GROUP_MIXED1000_PENDING_PRODUCTION_UPGRADE',
            package={'name':package.name,'bytes':package.stat().st_size,'sha256':sha(package)},installedAppTested=True,aiRuntimeTested=True,
            limits=['Two real originals and synthetic mixed1000, not unseen accuracy or physical GPU certification','Mac ad-hoc/not notarized','Original-endpoint production upgrade remains separate'])
        ok=True
    except Exception as error:
        result.update(status='FAIL',error=type(error).__name__+': '+str(error));(evidence/'ERROR.log').write_text(traceback.format_exc(),encoding='utf8')
    finally:
        for folder in ('build/reports','normal-subject/evidence','real-jpeg/evidence','synthetic-group/evidence','normal-thousand/evidence'):
            p=WORK/folder
            if p.is_dir():shutil.copytree(p,evidence/Path(folder).parent.name,dirs_exist_ok=True)
        result['stages']=stages;save(evidence/'SUMMARY.json',result)
        reports=WORK/'reports.zip'
        with zipfile.ZipFile(reports,'x',compression=zipfile.ZIP_DEFLATED) as z:
            for p in evidence.rglob('*'):
                if p.is_file():z.write(p,p.relative_to(evidence).as_posix())
        run('encrypt-reports',['node',transport,'encrypt','--input',reports,'--output',encrypted/'reports.enc','--manifest',encrypted/'REPORTS_READY.json','--id','reports'],private=True)
    return 0 if ok else 1
if __name__=='__main__':sys.exit(main())

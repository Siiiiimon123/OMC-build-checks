"""Owned free VM: reuse accepted AI closure, build/install current package, test actual UI."""
from pathlib import Path,PurePosixPath
import ast,base64,hashlib,json,os,shutil,subprocess,sys,traceback,zipfile

HERE=Path(__file__).resolve().parent
WORK=Path(os.environ['RUNNER_TEMP'])/'omc-followup21'
SOURCE_TREE='883787ae0ea60c56d348ff758fa150fb3f40007d'
def sha(file):
    with Path(file).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def save(file,value):Path(file).write_text(json.dumps(value,indent=2)+'\n',encoding='utf8')
def unzip(file,dest,limit):
    dest.mkdir()
    with zipfile.ZipFile(file) as z:
        assert len({i.filename.lower() for i in z.infolist()})==len(z.infolist())
        assert sum(i.file_size for i in z.infolist())<=limit
        for i in z.infolist():
            p=PurePosixPath(i.filename);assert not p.is_absolute() and '..' not in p.parts and '\\' not in i.filename and ':' not in i.filename
            assert not i.is_dir() and (i.external_attr>>16)&0o170000!=0o120000
            target=dest.joinpath(*p.parts);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(i))
def main():
    assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='Siiiiimon123/OMC-build-checks'
    assert os.environ.get('GITHUB_REF')=='refs/heads/verify-optimization20' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
    assert sys.platform in ('win32','darwin') and not WORK.exists()
    WORK.mkdir();evidence=WORK/'evidence';evidence.mkdir();encrypted=WORK/'encrypted';encrypted.mkdir()
    clean={k:v for k,v in os.environ.items() if k not in ('OMC_PREVIEW15_TRANSPORT_KEY','GH_TOKEN','GITHUB_TOKEN') and k.lower()!='psmodulepath'}
    clean['ELECTRON_SKIP_BINARY_DOWNLOAD']='1';clean['PYTHONDONTWRITEBYTECODE']='1'
    stages=[];result={'schema':'omc-frozen21-group-acceptance-v1','status':'RUNNING','sourceTree':SOURCE_TREE,
        'controlCommit':os.environ['GITHUB_SHA'],'backendRebuilt':False,'published':False,'productionUpgradeTested':False}
    package=None;ok=False;transport=WORK/'transport.cjs'
    # Preserve the already verified bytes; Windows checkout can convert LF.
    raw=subprocess.run(['git','show','HEAD:final19/transport.cjs'],cwd=HERE.parent,
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
    transport.write_bytes(raw)
    assert sha(transport)=='19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f'
    def run(name,args,cwd=WORK,timeout=900,private=False):
        print(json.dumps({'phase':name}),flush=True)
        with (evidence/(name+'.log')).open('xb') as log:
            p=subprocess.run(list(map(str,args)),cwd=cwd,env=os.environ if private else clean,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
        stages.append({'phase':name,'exit':p.returncode});assert p.returncode==0,name+'_FAILED'
    def decrypt(manifest,asset,cipher,output):run('decrypt-'+asset,['node',transport,'decrypt','--manifest',manifest,'--id',asset,'--input',cipher,'--output',output],private=True)
    try:
        current=HERE.parent/'opt20';cipher=WORK/'source.enc'
        with cipher.open('xb') as writer:
            for n in range(14):writer.write((current/('source.part%02d.enc'%n)).read_bytes())
        decrypt(current/'source.transport.json','source-r20',cipher,WORK/'source.zip')
        source=WORK/'source';unzip(WORK/'source.zip',source,16*1024**2)
        overlay=WORK/'overlay.enc';overlay.write_bytes(base64.b64decode((current/'overlay.b64').read_bytes(),validate=True))
        decrypt(current/'overlay.transport.json','r20-overlay',overlay,WORK/'overlay.zip')
        with zipfile.ZipFile(WORK/'overlay.zip') as z:
            rows=json.loads(z.read('PATCH.json'));assert len(rows)==56
            assert set(z.namelist())=={'PATCH.json',*(r['path'] for r in rows)}
            for r in rows:
                p=PurePosixPath(r['path']);assert not p.is_absolute() and '..' not in p.parts and '\\' not in r['path']
                dest=source.joinpath(*p.parts)
                assert not dest.exists() if r['beforeSha256'] is None else sha(dest)==r['beforeSha256']
                data=z.read(r['path']);assert hashlib.sha256(data).hexdigest()==r['sha256'];dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
        helper_cipher=WORK/'helpers.enc';helper_cipher.write_bytes(base64.b64decode((HERE/'helpers.b64').read_bytes(),validate=True))
        decrypt(HERE/'HELPERS.transport.json','final21-repair',helper_cipher,WORK/'helpers.zip')
        inputs=WORK/'inputs';unzip(WORK/'helpers.zip',inputs,2*1024**2)
        records=json.loads((inputs/'source19-records.json').read_bytes())
        assert records['sourceTree']==SOURCE_TREE and len(records['records'])==945
        assert {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}=={r['path'] for r in records['records']}
        for r in records['records']:assert sha(source/r['path'])==r['sha256']
        if sys.platform=='win32':
            ps="$ErrorActionPreference='Stop';Get-Command Get-FileHash,Get-CimInstance,Start-Process,ConvertFrom-Json -ErrorAction Stop|Out-Null;"
            for f in inputs.glob('*.ps1'):
                literal=str(f).replace("'","''")
                ps+="$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('"+literal+"',[ref]$t,[ref]$e);if($e.Count){throw ($e|Out-String)};"
            run('native-installer-helper-preflight',['powershell.exe','-NoProfile','-Command',ps],timeout=60)
        origin=json.loads((inputs/'runtime-origin-source.json').read_bytes());assert origin['sourceTree']=='31b79bac263eef3e2c32e9fabe8537f8d77401be'
        old={r['path']:r['sha256'] for r in origin['records'] if r['path'].startswith('ai-training/')}
        new={r['path']:r['sha256'] for r in records['records'] if r['path'].startswith('ai-training/')}
        assert old==new and len(old)==133
        save(evidence/'SOURCE_AND_AI_REUSE.json',{'sourceTree':SOURCE_TREE,'sourceFiles':945,'all133AiInputsIdentical':True,'backendOriginTree':origin['sourceTree']})
        npm='npm.cmd' if sys.platform=='win32' else 'npm'
        run('fixed-build-dependencies',[npm,'ci','--ignore-scripts','--no-audit','--no-fund'],source,600)
        save(evidence/'REUSED_SOURCE_CHECKS.json',{'sourceTree':SOURCE_TREE,'run':42259341867,
            'coreBrowserBuildPassedBothPlatforms':True,'sourceUnchanged':True,
            'reportSha256Windows':'ba8edf7e0cb73e9531e8785ad5bfe1f8aee32ef437bae553c274c0c761094fb3',
            'reportSha256Mac':'79b8d261acb9b571c10fba2514cfd4300bd66ebb8f63ac95402a9cf9d7ec4bac'})
        mode='windows' if sys.platform=='win32' else 'mac'
        base_info=json.loads((HERE/'FOLLOWUP_ARTIFACTS.json').read_bytes())[mode]
        assert base_info['plainSha256'] and base_info['acceptedInstalledRun']
        artifact=WORK/'current21.zip'
        run('fetch-same-package21',['node',HERE/'fetch-frozen21.mjs',mode,artifact],timeout=600,private=True)
        frozen=WORK/'frozen-package';unzip(artifact,frozen,1100*1024**2)
        assert {p.name for p in frozen.iterdir()}=={'PACKAGE_READY.json','package.enc'}
        package=WORK/('current21.exe' if mode=='windows' else 'current21.pkg')
        decrypt(frozen/'PACKAGE_READY.json','pkg',frozen/'package.enc',package)
        assert package.stat().st_size==base_info['plainBytes'] and sha(package)==base_info['plainSha256']
        artifact.unlink();(frozen/'package.enc').unlink()
        if mode=='windows':
            built=json.loads((inputs/'REUSED_WINDOWS21_INPUTS.json').read_bytes())
            assert built['current']['bytes']==package.stat().st_size and built['current']['sha256']==sha(package)
            built['current']['path']=str(package);install_input=inputs/'PACKAGE_INPUTS.json';save(install_input,built)
            run('install-exact-frozen-windows21',['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',inputs/'Install-FinalWindows.ps1','-InputsPath',install_input,'-OutputPath',evidence/'FIRST_INSTALL.json'],timeout=600)
            install=json.loads((evidence/'FIRST_INSTALL.json').read_text(encoding='utf-8-sig'));assert install['installedPayloadPassed']
            installed=install['executable']
        else:
            installed_app=Path('/Applications/OMC-Preview.app');assert not installed_app.exists()
            run('install-exact-frozen-mac21',['sudo','/usr/sbin/installer','-pkg',package,'-target','/'],timeout=600)
            run('verify-installed-signature',['/usr/bin/codesign','--verify','--deep','--strict',installed_app])
            run('verify-installed-entry',['node',HERE/'verify-mac-entry.cjs',source,installed_app,base_info['asarSha256'],evidence/'MAC_APP_ENTRY.json'],source,300)
            installed=installed_app/'Contents/MacOS/OMC-Preview'
        case=WORK/'synthetic-group';case.mkdir()
        run('installed-synthetic-group-edit-crop-export',['node',HERE/'cloud-final-installed.mjs',source,case,'',installed],source,1200)
        group=json.loads((case/'evidence/FINISHED_FLOW.json').read_bytes())
        assert group['status']=='PASS_INSTALLED_FINISHED_JPEG_GROUP_AND_EXPORT'
        assert group['group']['realCandidateGroup'] is True and group['group']['selectionAndDecisionPreserved'] is True
        assert len(group['exported'])==2 and group['originalsUnchanged'] is True
        result.update(status='PASS_FROZEN_PACKAGE_SYNTHETIC_GROUP_EDIT_CROP_EXPORT',
            package={'bytes':package.stat().st_size,'sha256':sha(package)},groupTested=True,
            packageRebuilt=False,normalAiSubjectEvidenceReusedFromRun=base_info['acceptedInstalledRun'],
            limits=['Synthetic pair, not independently labelled camera group; actual UI/group/editor/export',
                    'No new product build, real-photo upload or repeated completed subject case'])
        ok=True
    except Exception as e:
        result.update(status='FAIL',error=type(e).__name__+': '+str(e));(evidence/'CONTROLLER_ERROR.log').write_text(traceback.format_exc(),encoding='utf8')
    finally:
        for p in (WORK/'synthetic-group/evidence',):
            if p.is_dir():shutil.copytree(p,evidence/p.parent.name,dirs_exist_ok=True)
        result['stages']=stages;save(evidence/'SUMMARY.json',result)
        reports=WORK/'reports.zip'
        with zipfile.ZipFile(reports,'x',compression=zipfile.ZIP_DEFLATED) as z:
            for p in sorted(evidence.rglob('*')):
                if p.is_file():z.write(p,p.relative_to(evidence).as_posix())
        run('encrypt-current-reports',['node',transport,'encrypt','--input',reports,'--output',encrypted/'reports.enc','--manifest',encrypted/'REPORTS_READY.json','--id','reports'],private=True)
        print(json.dumps({'status':result['status'],'published':False}),flush=True)
    return 0 if ok else 1
if __name__=='__main__':sys.exit(main())

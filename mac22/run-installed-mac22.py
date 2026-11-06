"""Reuse exact native Mac22 package; finish installed acceptance without rebuilding."""
from pathlib import Path,PurePosixPath
import base64,hashlib,json,os,platform,shutil,subprocess,sys,traceback,urllib.request,zipfile
HERE=Path(__file__).resolve().parent
WORK=Path(os.environ['RUNNER_TEMP'])/'omc-accept-mac22'
def sha(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(path,value):Path(path).write_text(json.dumps(value,indent=2)+'\n',encoding='utf8')
def unzip(file,destination,limit):
    destination.mkdir()
    with zipfile.ZipFile(file) as z:
        assert len({i.filename.lower() for i in z.infolist()})==len(z.infolist()) and sum(i.file_size for i in z.infolist())<=limit
        for i in z.infolist():
            p=PurePosixPath(i.filename)
            assert not p.is_absolute() and '..' not in p.parts and '\\' not in i.filename and ':' not in i.filename
            assert not i.is_dir() and (i.external_attr>>16)&0o170000!=0o120000
            target=destination.joinpath(*p.parts);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(i))
def main():
    assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='Siiiiimon123/OMC-build-checks'
    assert os.environ.get('GITHUB_REF')=='refs/heads/verify-optimization20' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
    assert sys.platform=='darwin' and platform.machine()=='arm64' and platform.python_version()=='3.12.10' and not WORK.exists()
    WORK.mkdir();evidence=WORK/'evidence';evidence.mkdir();encrypted=WORK/'encrypted';encrypted.mkdir()
    spec=json.loads((HERE/'CURRENT_SOURCE_INPUT.json').read_bytes())
    result={'status':'RUNNING','sourceTree':spec['sourceTree'],'controlCommit':os.environ['GITHUB_SHA'],
        'installedAppTested':False,'aiRuntimeTested':False,'published':False,'packageRebuilt':False,'priorNativeBuildRun':42294003221}
    clean={k:v for k,v in os.environ.items() if k not in ('OMC_PREVIEW15_TRANSPORT_KEY','GH_TOKEN','GITHUB_TOKEN')}
    clean['ELECTRON_SKIP_BINARY_DOWNLOAD']='1';clean['PYTHONDONTWRITEBYTECODE']='1'
    stages=[];transport=WORK/'transport.cjs';package=None
    transport.write_bytes(subprocess.run(['git','show','HEAD:final19/transport.cjs'],cwd=HERE.parent,check=True,stdout=subprocess.PIPE).stdout)
    assert sha(transport)=='19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f'
    def run(name,args,private=False,cwd=WORK,timeout=600):
        print(json.dumps({'phase':name}),flush=True)
        with (evidence/(name+'.log')).open('xb') as log:
            p=subprocess.run(list(map(str,args)),cwd=cwd,env=os.environ if private else clean,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
        stages.append({'phase':name,'exit':p.returncode});assert p.returncode==0,name+'_FAILED'
    def decrypt(manifest,asset,cipher,target):run('decrypt-'+asset,['node',transport,'decrypt','--manifest',manifest,'--id',asset,'--input',cipher,'--output',target],True)
    try:
        old=HERE.parent/'opt20';cipher=WORK/'base.enc'
        with cipher.open('xb') as out:
            for i in range(14):out.write((old/('source.part%02d.enc'%i)).read_bytes())
        decrypt(old/'source.transport.json','source-r20',cipher,WORK/'base.zip')
        source=WORK/'source';unzip(WORK/'base.zip',source,16*1024**2)
        overlay=WORK/'overlay.enc';overlay.write_bytes(base64.b64decode((old/'overlay.b64').read_bytes(),validate=True))
        decrypt(old/'overlay.transport.json','r20-overlay',overlay,WORK/'overlay.zip')
        with zipfile.ZipFile(WORK/'overlay.zip') as z:
            patch=json.loads(z.read('PATCH.json'));assert len(patch)==56
            assert set(z.namelist())=={'PATCH.json',*(r['path'] for r in patch)}
            for r in patch:
                p=PurePosixPath(r['path']);assert not p.is_absolute() and '..' not in p.parts and '\\' not in r['path'] and ':' not in r['path']
                dest=source.joinpath(*p.parts);assert not dest.exists() if r['beforeSha256'] is None else sha(dest)==r['beforeSha256']
                data=z.read(r['path']);assert hashlib.sha256(data).hexdigest()==r['sha256'];dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
        current_cipher=WORK/'current.enc'
        current_cipher.write_bytes(b''.join(base64.b64decode((HERE/('current-source.part%d.b64'%i)).read_bytes(),validate=True) for i in range(spec['parts'])))
        decrypt(HERE/'CURRENT_SOURCE.transport.json','current-source-checks',current_cipher,WORK/'current.zip')
        inputs=WORK/'inputs';unzip(WORK/'current.zip',inputs,2*1024**2)
        baseline=json.loads((inputs/'BASELINE.json').read_bytes());assert baseline['sourceTree']=='883787ae0ea60c56d348ff758fa150fb3f40007d'
        for row in baseline['records']:assert sha(source/row['path'])==row['sha256']
        for row in json.loads((inputs/'PATCH.json').read_bytes()):
            p=PurePosixPath(row['path']);assert not p.is_absolute() and '..' not in p.parts and '\\' not in row['path'] and ':' not in row['path']
            target=source.joinpath(*p.parts);assert not target.exists() if row['beforeSha256'] is None else sha(target)==row['beforeSha256']
            data=(inputs/row['path']).read_bytes();assert hashlib.sha256(data).hexdigest()==row['sha256'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        candidate=json.loads((inputs/'CANDIDATE.json').read_bytes());assert candidate['sourceTree']==spec['sourceTree'] and len(candidate['records'])==946
        assert sha(inputs/'pkg_contract_adapter.py')==spec['pkgAdapterSha256']
        assert {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}=={r['path'] for r in candidate['records']}
        for row in candidate['records']:assert sha(source/row['path'])==row['sha256']
        save(evidence/'REUSED_SOURCE_LOGIC_CHECKS.json',{'sourceTree':spec['sourceTree'],
            'logicSource':'a3f7ecf66b42d4d5ff11a91a5d077a114026da94','onlyVersionFieldsChanged':True,
            'core':{'run':42284997946,'passed':364},'browser':{'run':42284997946,'passed':9},
            'browserBuild':{'run':42286012791,'passed':True},'notRepeated':True})
        run('fixed-qa-dependencies',['npm','ci','--ignore-scripts','--no-audit','--no-fund'],cwd=source,timeout=600)
        frozen=WORK/'frozen-artifact.zip'
        run('fetch-exact-native22-package',['node',HERE/'fetch-native22.mjs','mac',frozen],True,timeout=600)
        extracted=WORK/'frozen';unzip(frozen,extracted,1100*1024**2)
        assert {p.name for p in extracted.iterdir()}=={'PACKAGE_READY.json','package.enc'}
        package=WORK/'current22.pkg';decrypt(extracted/'PACKAGE_READY.json','pkg',extracted/'package.enc',package)
        assert package.stat().st_size==986592598 and sha(package)=='a1ecd40f95fd3da62f4cb8285a6a6c0b3de68032909d51f163654cf9793d1620'
        # Only this VM's authenticated reproducible transport copies; keeper is package.
        frozen.unlink();(extracted/'package.enc').unlink()
        installed_app=Path('/Applications/OMC-Preview.app');assert not installed_app.exists()
        run('install-exact-native22-package',['sudo','/usr/sbin/installer','-pkg',package,'-target','/'],timeout=600)
        run('verify-installed-signature',['/usr/bin/codesign','--verify','--deep','--strict',installed_app])
        run('verify-installed-entry',['node',HERE/'verify-mac-entry.cjs',source,installed_app,'a29daa7c76b52f32bcbe73b6cc1c432172421a902b6b902eef6e863b2757dca8',evidence/'MAC_APP_ENTRY.json'],cwd=source)
        installed=installed_app/'Contents/MacOS/OMC-Preview';assert installed.is_file()
        built={'derivedSourceTree':'e262198357fb9071fb93560c3f43a185d210c892'}
        save(evidence/'EXACT_NATIVE_BUILD_REUSE.json',{'sourceTree':spec['sourceTree'],'buildRun':42294003221,'buildControl':'8fa65eb19f1efd11cedf6f360d6664f812c098fd','nativeBuildAndPayloadReadbackAndFirstInstallPassed':True,'newPackageBuilt':False,'packageBytes':package.stat().st_size,'packageSha256':sha(package),'derivedSourceTree':built['derivedSourceTree']})
        photos=HERE.parent/'jpeg19-source';photo_inputs=json.loads((photos/'INPUT.json').read_bytes())
        for a in photo_inputs['assets']:
            if a['id'] not in ('sample-a','sample-b'):continue
            target=WORK/(a['id']+'.enc')
            with target.open('xb') as writer:
                for p in sorted((photos/'inputs'/a['id']).glob('*.enc')):writer.write(p.read_bytes())
            assert target.stat().st_size==a['ciphertextBytes'] and sha(target)==a['ciphertextSha256']
            meta=WORK/(a['id']+'.json');save(meta,{'schema':'omc-aes256gcm-build-transport-v1','assets':[a]})
            decrypt(meta,a['id'],target,WORK/(a['id']+'.jpg'))
        case=WORK/'normal-subject';case.mkdir()
        run('installed-new-backend-subject-restore',['node',HERE/'cloud-subject-workflow.mjs',source,case,
            WORK/'sample-a.jpg',WORK/'sample-b.jpg',installed,spec['sourceTree']],cwd=source,timeout=1200)
        subjects=json.loads((case/'evidence/PROJECT_ENDURANCE.json').read_bytes())
        assert subjects['status']=='PASS_INSTALLED_NORMAL_AI_SUBJECT_CLASSIFICATION_RESTORE_RESTART' and subjects['originalsUnchanged']
        for name,fixture in [('real-jpeg',str(WORK/'sample-b.jpg')),('synthetic-group','')]:
            case=WORK/name;case.mkdir()
            run('installed-'+name,['node',HERE/'cloud-final-installed.mjs',source,case,fixture,installed],cwd=source,timeout=900)
            measured=json.loads((case/'evidence/JPEG_FUNCTIONAL.json').read_bytes())
            assert measured['status']=='PASS_INSTALLED_FULL_AI_AND_FINISHED_JPEG_FLOW' and measured['originalUnchanged']
            if name=='synthetic-group':
                group=measured['finishedFlow']['group']
                assert group['realCandidateGroup'] and group['selectionAndDecisionPreserved']
                assert len(measured['finishedFlow']['exported'])==2
        case=WORK/'normal-thousand';case.mkdir()
        run('installed-new-backend-mixed-thousand',['node',HERE/'cloud-project-endurance21.mjs',source,case,
            WORK/'sample-a.jpg',WORK/'sample-b.jpg',installed,spec['sourceTree']],cwd=source,timeout=2400)
        thousand=json.loads((case/'evidence/PROJECT_ENDURANCE.json').read_bytes())
        assert thousand['status']=='PASS_INSTALLED_NORMAL_PROJECT_1000_IMPORT_AI_RESTART' and thousand['originalsUnchanged']
        assert thousand['automaticReview']['severeSubjectControlsPassed']==3 and thousand['automaticReview']['clearOriginalsPreserved']==2
        result.update(status='PASS_NATIVE_MAC22_INSTALL_AI_SUBJECT_JPEG_GROUP_MIXED1000_PENDING_PRODUCTION_UPGRADE',sourceFiles=946,
            package={'bytes':package.stat().st_size,'sha256':sha(package),'name':package.name},
            installedAppTested=True,aiRuntimeTested=True,productionUpgradeTested=False,
            nativeSourceDerivation=built['derivedSourceTree'],runtimeRoute=thousand.get('runtimeRoute'),
            importObservedMs=thousand['importObservedMs'],analysisObservedMs=thousand['analysisObservedMs'],
            limits=['Two originals and generated mixed workload,not independent1000 real photos or accuracy certification',
                'Mac ad-hoc unsigned/not notarized; original-endpoint upgrade remains separate'])
    except Exception as error:
        result.update(status='FAIL',error=type(error).__name__+': '+str(error));(evidence/'ERROR.log').write_text(traceback.format_exc(),encoding='utf8')
    finally:
        for folder in ('native-build/reports','normal-subject/evidence','real-jpeg/evidence','synthetic-group/evidence','normal-thousand/evidence'):
            p=WORK/folder
            if p.is_dir():shutil.copytree(p,evidence/Path(folder).parent.name,dirs_exist_ok=True)
        result['stages']=stages;save(evidence/'SUMMARY.json',result)
        reports=WORK/'reports.zip'
        with zipfile.ZipFile(reports,'x',compression=zipfile.ZIP_DEFLATED) as z:
            for p in evidence.rglob('*'):
                if p.is_file():z.write(p,p.relative_to(evidence).as_posix())
        run('encrypt-reports',['node',transport,'encrypt','--input',reports,'--output',encrypted/'reports.enc','--manifest',encrypted/'REPORTS_READY.json','--id','reports'],True)
    return 0 if result['status']=='PASS_NATIVE_MAC22_INSTALL_AI_SUBJECT_JPEG_GROUP_MIXED1000_PENDING_PRODUCTION_UPGRADE' else 1
if __name__=='__main__':sys.exit(main())

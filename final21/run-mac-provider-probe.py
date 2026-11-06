"""Generic cloud-only probe of fixed already accepted model/package bytes."""
from pathlib import Path,PurePosixPath
import base64,hashlib,json,os,platform,shutil,subprocess,sys,traceback,zipfile

HERE=Path(__file__).resolve().parent
WORK=Path(os.environ['RUNNER_TEMP'])/'omc-provider21'

def sha(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def save(path,value):Path(path).write_text(json.dumps(value,indent=2)+'\n',encoding='utf8')

def main():
    assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='Siiiiimon123/OMC-build-checks'
    assert os.environ.get('GITHUB_REF')=='refs/heads/verify-optimization20' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
    assert sys.platform=='darwin' and platform.machine()=='arm64' and not WORK.exists()
    WORK.mkdir();evidence=WORK/'evidence';evidence.mkdir();encrypted=WORK/'encrypted';encrypted.mkdir()
    clean={k:v for k,v in os.environ.items() if k not in ('OMC_PREVIEW15_TRANSPORT_KEY','GH_TOKEN','GITHUB_TOKEN')}
    clean['PYTHONDONTWRITEBYTECODE']='1';clean['PYTHONNOUSERSITE']='1'
    transport=WORK/'transport.cjs'
    transport.write_bytes(subprocess.run(['git','show','HEAD:final19/transport.cjs'],cwd=HERE.parent,check=True,stdout=subprocess.PIPE).stdout)
    assert sha(transport)=='19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f'
    stages=[];result={'status':'RUNNING','sourceTree':'883787ae0ea60c56d348ff758fa150fb3f40007d',
        'controlCommit':os.environ['GITHUB_SHA'],'productChanged':False,'published':False}
    def run(name,args,private=False,timeout=300,env=None):
        print(json.dumps({'phase':name}),flush=True)
        with (evidence/(name+'.log')).open('xb') as log:
            p=subprocess.run(list(map(str,args)),env=env if env is not None else (os.environ if private else clean),stdout=log,stderr=subprocess.STDOUT,timeout=timeout,cwd=WORK)
        stages.append({'phase':name,'exit':p.returncode});assert p.returncode==0,name+'_FAILED'
    try:
        archive=WORK/'package.zip';run('fetch-exact-frozen-package',['node',HERE/'fetch-frozen21.mjs','mac',archive],True,600)
        frozen=WORK/'frozen';frozen.mkdir()
        with zipfile.ZipFile(archive) as z:
            assert set(z.namelist())=={'PACKAGE_READY.json','package.enc'}
            assert sum(i.file_size for i in z.infolist())<1100*1024**2
            for i in z.infolist():
                assert not i.is_dir() and (i.external_attr>>16)&0o170000!=0o120000
                with z.open(i) as reader,(frozen/i.filename).open('xb') as writer:shutil.copyfileobj(reader,writer,1024*1024)
        archive.unlink()
        package=WORK/'frozen21.pkg'
        run('decrypt-frozen-package',['node',transport,'decrypt','--manifest',frozen/'PACKAGE_READY.json','--id','pkg','--input',frozen/'package.enc','--output',package],True,300)
        expected=json.loads((HERE/'FOLLOWUP_ARTIFACTS.json').read_bytes())['mac']
        assert sha(package)==expected['plainSha256'] and package.stat().st_size==expected['plainBytes']
        (frozen/'package.enc').unlink()
        app=Path('/Applications/OMC-Preview.app');assert not app.exists()
        run('install-same-package',['sudo','/usr/sbin/installer','-pkg',package,'-target','/'],timeout=600)
        run('verify-signature',['/usr/bin/codesign','--verify','--deep','--strict',app])
        package.unlink()
        def tree_bytes(root):return sum(p.stat().st_size for p in root.rglob('*') if p.is_file() and not p.is_symlink())
        used=tree_bytes(app)+tree_bytes(WORK);assert used+512*1024**2<5*1024**3
        save(evidence/'REUSE_BUDGET.json',{'bytesBeforeProbeDependencies':used,'limit':5*1024**3,'samePackageSha256':expected['plainSha256']})
        deps=WORK/'probe-python';wheels=WORK/'wheels';wheels.mkdir()
        run('download-same-fixed-probe-dependencies',[sys.executable,'-m','pip','download','--disable-pip-version-check','--only-binary=:all:','--no-deps','--dest',wheels,'--index-url','https://pypi.org/simple','numpy==2.5.2','onnxruntime==1.19.2'],timeout=300)
        files=list(wheels.glob('*.whl'));assert len(files)==2 and sum(p.stat().st_size for p in files)<128*1024**2
        save(evidence/'PROBE_WHEELS.json',[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in files])
        run('install-isolated-probe-dependencies',[sys.executable,'-m','pip','install','--disable-pip-version-check','--no-index','--no-deps','--target',deps,*files],timeout=180)
        for p in files:p.unlink()
        assert tree_bytes(app)+tree_bytes(WORK)<5*1024**3
        probe_env=dict(clean);probe_env['PYTHONPATH']=str(deps)
        run('same-machine-fixed-model-comparison',[sys.executable,HERE/'mac-provider-probe.py',app,HERE/'PROVIDER_MODEL_IDENTITIES.json',evidence/'probe'],timeout=1800,env=probe_env)
        measured=json.loads((evidence/'probe/PROVIDER_COMPARISON.json').read_bytes())
        assert measured['status']=='PASS_BOUNDED_MODEL_LATENCY_MEASUREMENT'
        result.update(status=measured['status'],packageSha256=expected['plainSha256'],roles=measured['roles'],limits=measured['limits'])
    except Exception as e:
        result.update(status='FAIL',error=type(e).__name__+': '+str(e));(evidence/'ERROR.log').write_text(traceback.format_exc(),encoding='utf8')
    finally:
        result['stages']=stages;save(evidence/'SUMMARY.json',result)
        reports=WORK/'reports.zip'
        with zipfile.ZipFile(reports,'x',compression=zipfile.ZIP_DEFLATED) as z:
            for p in sorted(evidence.rglob('*')):
                if p.is_file():z.write(p,p.relative_to(evidence).as_posix())
        run('encrypt-reports',['node',transport,'encrypt','--input',reports,'--output',encrypted/'reports.enc','--manifest',encrypted/'REPORTS_READY.json','--id','reports'],True)
        print(json.dumps({'status':result['status'],'productChanged':False}),flush=True)
    return 0 if result['status']=='PASS_BOUNDED_MODEL_LATENCY_MEASUREMENT' else 1

if __name__=='__main__':sys.exit(main())

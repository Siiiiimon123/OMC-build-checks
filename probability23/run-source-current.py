"""Source-only core/browser/build checks; no desktop runtime or model staging."""
from pathlib import Path,PurePosixPath
import base64,hashlib,json,os,subprocess,sys,traceback,zipfile
HERE=Path(__file__).resolve().parent
WORK=Path(os.environ['RUNNER_TEMP'])/'omc-probability-source23'
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
    assert sys.platform=='win32' and not WORK.exists()
    WORK.mkdir();evidence=WORK/'evidence';evidence.mkdir();encrypted=WORK/'encrypted';encrypted.mkdir()
    spec=json.loads((HERE/'CURRENT_SOURCE_INPUT.json').read_bytes())
    result={'status':'RUNNING','sourceTree':spec['sourceTree'],'controlCommit':os.environ['GITHUB_SHA'],
        'installedAppTested':False,'aiRuntimeTested':False,'published':False}
    clean={k:v for k,v in os.environ.items() if k not in ('OMC_PREVIEW15_TRANSPORT_KEY','GH_TOKEN','GITHUB_TOKEN')}
    clean['ELECTRON_SKIP_BINARY_DOWNLOAD']='1';clean['PYTHONDONTWRITEBYTECODE']='1'
    stages=[];transport=WORK/'transport.cjs'
    transport.write_bytes(subprocess.run(['git','show','HEAD:final19/transport.cjs'],cwd=HERE.parent,check=True,stdout=subprocess.PIPE).stdout)
    assert sha(transport)=='19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f'
    def run(name,args,private=False,cwd=WORK):
        print(json.dumps({'phase':name}),flush=True)
        with (evidence/(name+'.log')).open('xb') as log:
            p=subprocess.run(list(map(str,args)),cwd=cwd,env=os.environ if private else clean,stdout=log,stderr=subprocess.STDOUT,timeout=600)
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
        assert {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}=={r['path'] for r in candidate['records']}
        for row in candidate['records']:assert sha(source/row['path'])==row['sha256']
        run('fixed-source-dependencies',['npm.cmd','ci','--ignore-scripts','--no-audit','--no-fund'],cwd=source)
        for script in ('test:core','test:browser-preview'):
            run(script.replace(':','-'),['npm.cmd','run',script],cwd=source)
        preview=source/'preview-manifest.json';original=None
        if preview.exists():
            original=preview.read_bytes();expected_manifest=next(r['sha256'] for r in candidate['records'] if r['path']=='preview-manifest.json')
            assert sha(preview)==expected_manifest
            preview.rename(evidence/'previous-preview-manifest.json')
        try:
            run('build-browser-preview',['npm.cmd','run','build:browser-preview'],cwd=source)
        finally:
            if preview.exists():preview.rename(evidence/'generated-preview-manifest.json')
            if original is not None:
                preview.write_bytes(original);assert sha(preview)==expected_manifest

        result.update(status='PASS_CURRENT_SOURCE_CORE_BROWSER_AND_BROWSER_BUILD',sourceFiles=946,
            limits=['Source-only checks; installed native AI/new backend/throughput and upgrades not tested'])
    except Exception as error:
        result.update(status='FAIL',error=type(error).__name__+': '+str(error));(evidence/'ERROR.log').write_text(traceback.format_exc(),encoding='utf8')
    finally:
        result['stages']=stages;save(evidence/'SUMMARY.json',result)
        reports=WORK/'reports.zip'
        with zipfile.ZipFile(reports,'x',compression=zipfile.ZIP_DEFLATED) as z:
            for p in evidence.iterdir():
                if p.is_file():z.write(p,p.name)
        run('encrypt-reports',['node',transport,'encrypt','--input',reports,'--output',encrypted/'reports.enc','--manifest',encrypted/'REPORTS_READY.json','--id','reports'],True)
    return 0 if result['status']=='PASS_CURRENT_SOURCE_CORE_BROWSER_AND_BROWSER_BUILD' else 1
if __name__=='__main__':sys.exit(main())

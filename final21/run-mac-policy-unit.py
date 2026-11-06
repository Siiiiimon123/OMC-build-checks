"""Source-only regression in a free Windows VM; no desktop app or model copy."""
from pathlib import Path,PurePosixPath
import ast,base64,hashlib,json,os,re,subprocess,sys,traceback,zipfile

HERE=Path(__file__).resolve().parent
WORK=Path(os.environ['RUNNER_TEMP'])/'omc-mac-policy-unit21'
TREE='4d79f85b873f32f2f28c4290fa2984a0cb7eef3d'
def sha(p):
    with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(p,value):Path(p).write_text(json.dumps(value,indent=2)+'\n',encoding='utf8')
def main():
    assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='Siiiiimon123/OMC-build-checks'
    assert os.environ.get('GITHUB_REF')=='refs/heads/verify-optimization20' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
    assert sys.platform=='win32' and not WORK.exists()
    WORK.mkdir();evidence=WORK/'evidence';evidence.mkdir();encrypted=WORK/'encrypted';encrypted.mkdir()
    clean={k:v for k,v in os.environ.items() if k not in ('OMC_PREVIEW15_TRANSPORT_KEY','GH_TOKEN','GITHUB_TOKEN')}
    clean['PYTHONDONTWRITEBYTECODE']='1';clean['PYTHONNOUSERSITE']='1'
    transport=WORK/'transport.cjs'
    transport.write_bytes(subprocess.run(['git','show','HEAD:final19/transport.cjs'],cwd=HERE.parent,check=True,stdout=subprocess.PIPE).stdout)
    assert sha(transport)=='19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f'
    result={'status':'RUNNING','sourceTree':TREE,'controlCommit':os.environ['GITHUB_SHA'],
        'installedAppTested':False,'modelInferenceTested':False,'published':False};stages=[]
    def run(name,args,private=False,env=None):
        print(json.dumps({'phase':name}),flush=True)
        with (evidence/(name+'.log')).open('xb') as f:
            p=subprocess.run(list(map(str,args)),cwd=WORK,env=env or (os.environ if private else clean),stdout=f,stderr=subprocess.STDOUT,timeout=180)
        stages.append({'phase':name,'exit':p.returncode});assert p.returncode==0,name+'_FAILED'
    try:
        cipher=WORK/'source.enc';cipher.write_bytes(b''.join(base64.b64decode((HERE/('mac-role-source.part%d.b64'%i)).read_bytes(),validate=True) for i in range(2)))
        archive=WORK/'source.zip'
        run('decrypt-candidate',['node',transport,'decrypt','--manifest',HERE/'MAC_POLICY_ROLE_GUARD.transport.json','--id','mac-policy-role-guard','--input',cipher,'--output',archive],True)
        source=WORK/'candidate';source.mkdir()
        with zipfile.ZipFile(archive) as z:
            assert len(z.infolist())==6 and len({i.filename for i in z.infolist()})==6 and sum(i.file_size for i in z.infolist())<1024**2
            for entry in z.infolist():
                p=PurePosixPath(entry.filename)
                assert not p.is_absolute() and '..' not in p.parts and '\\' not in entry.filename and ':' not in entry.filename
                assert not entry.is_dir() and (entry.external_attr>>16)&0o170000!=0o120000
                dest=source.joinpath(*p.parts);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(entry))
        manifest=json.loads((source/'CANDIDATE.json').read_bytes());assert manifest['sourceTree']==TREE and len(manifest['files'])==5
        for row in manifest['files']:
            assert sha(source/row['path'])==row['sha256'];ast.parse((source/row['path']).read_text(encoding='utf8'))
        deps=WORK/'probe-python'
        run('isolated-existing-fixed-numpy',[sys.executable,'-m','pip','install','--disable-pip-version-check','--only-binary=:all:','--no-deps','--target',deps,'--index-url','https://pypi.org/simple','numpy==2.5.2'])
        unit_env=dict(clean);unit_env['PYTHONPATH']=str(deps)
        run('source-regressions',[sys.executable,'-m','unittest','discover','-s',source/'ai-training/tests','-p','test_*_unit.py','-v'],env=unit_env)
        match=re.search(r'Ran (\d+) tests? in',(evidence/'source-regressions.log').read_text(encoding='utf8'))
        assert match and int(match.group(1))>=11
        result.update(status='PASS_SOURCE_POLICY_AND_ROLE_PRESERVATION_UNITS',tests=int(match.group(1)),sourceFiles=manifest['files'],
            limits=['Source-only AST-isolated contracts; not bundled runtime/installedMac or full throughput acceptance','No photo/model/runtime/package download or local desktop test'])
    except Exception as error:
        result.update(status='FAIL',error=type(error).__name__+': '+str(error));(evidence/'ERROR.log').write_text(traceback.format_exc(),encoding='utf8')
    finally:
        result['stages']=stages;save(evidence/'SUMMARY.json',result)
        report=WORK/'reports.zip'
        with zipfile.ZipFile(report,'x',compression=zipfile.ZIP_DEFLATED) as z:
            for p in sorted(evidence.iterdir()):
                if p.is_file():z.write(p,p.name)
        run('encrypt-reports',['node',transport,'encrypt','--input',report,'--output',encrypted/'reports.enc','--manifest',encrypted/'REPORTS_READY.json','--id','reports'],True)
    return 0 if result['status']=='PASS_SOURCE_POLICY_AND_ROLE_PRESERVATION_UNITS' else 1
if __name__=='__main__':sys.exit(main())

"""Synthetic-only source acceptance on one free Windows VM. No installer claim."""
import os,json,hashlib,subprocess,sys,urllib.request,zipfile,time,traceback
from pathlib import Path,PurePosixPath
HERE=Path(__file__).resolve().parent
WORK=Path(os.environ['RUNNER_TEMP'])/'omc-jpeg19-cloud'
EVIDENCE=WORK/'evidence'
TREE='1e39b9ae2921480b27d4a1a8bf5f8499004886fa'
def sha(b):return hashlib.sha256(b).hexdigest()
def gitsha(kind,b):return hashlib.sha1(kind.encode()+b' '+str(len(b)).encode()+b'\0'+b).hexdigest()
def git_tree(records):
 root={}
 for r in records:
  d=root;parts=r['path'].split('/')
  for p in parts[:-1]:d=d.setdefault(p,{})
  d[parts[-1]]=r
 def tree(d):
  rows=[]
  for name,v in d.items():
   is_dir='path' not in v
   rows.append((name.encode()+ (b'/' if is_dir else b''),('40000' if is_dir else v['mode']).encode()+b' '+name.encode()+b'\0'+bytes.fromhex(tree(v) if is_dir else v['gitBlobSha1'])))
  return gitsha('tree',b''.join(v for _,v in sorted(rows)))
 return tree(root)
def save(p,v):p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf8')
def phase(s):print(json.dumps({'phase':s}),flush=True)
env={k:v for k,v in os.environ.items() if k not in ('OMC_PREVIEW15_TRANSPORT_KEY','GH_TOKEN','GITHUB_TOKEN')}
def run(name,args,timeout=600,cwd=None,private=False):
 phase(name)
 with (EVIDENCE/(name+'.log')).open('wb') as log:
  r=subprocess.run(args,cwd=cwd,env=os.environ if private else env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
 return r.returncode
result={'schema':'omc-cloud-source-stage-v1','sourceTree':TREE,'status':'RUNNING','syntheticOnly':True,'originalPhotosTransferred':False,'installedPackageTested':False,'checks':{}}
try:
 assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='Siiiiimon123/OMC-build-checks'
 assert os.environ.get('GITHUB_REF')=='refs/heads/verify-jpeg19-cloud' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
 assert sys.platform=='win32' and not WORK.exists()
 EVIDENCE.mkdir(parents=True)
 phase('authenticated_source_input')
 cfg=json.loads((HERE/'INPUT.json').read_text())
 for asset in cfg['assets']:
  target=WORK/(asset['id']+'.enc');meta=WORK/(asset['id']+'.json');plain=WORK/(asset['id']+'.plain');save(meta,asset)
  # Authenticated ciphertext travels in this Git checkout, avoiding a failing source TLS path.
  parts=sorted((HERE/'inputs'/asset['id']).glob('*.enc'));assert len(parts)==(asset['ciphertextBytes']+65535)//65536
  with target.open('xb') as f:
   for i,p in enumerate(parts):
    assert p.name==str(i).zfill(4)+'.enc';f.write(p.read_bytes())
  assert target.stat().st_size==asset['ciphertextBytes']
  assert run('decrypt-'+asset['id'],['node',str(HERE/'cloud-transport.mjs'),'decrypt',str(target),str(plain),str(meta)],private=True)==0
  if asset['id'].startswith('sample-'):result['originalPhotosTransferred']=True;result['syntheticOnly']=False
 records=json.loads((WORK/'source19-records.plain').read_bytes())['records'];assert len(records)==932 and git_tree(records)==TREE
 source=WORK/'source';source.mkdir();by={r['path']:r for r in records}
 with zipfile.ZipFile(WORK/'source19.plain') as z:
  assert len(z.infolist())==len(by) and set(z.namelist())==set(by)
  for row in z.infolist():
   name=row.filename;p=PurePosixPath(name);assert not p.is_absolute() and '\\' not in name and ':' not in name and all(x not in ('','.','..') for x in name.split('/')) and not row.is_dir() and (row.external_attr>>16)&0o170000!=0o120000
   b=z.read(row);r=by[name];assert len(b)==r['bytes'] and sha(b)==r['sha256'] and gitsha('blob',b)==r['gitBlobSha1']
   dest=source.joinpath(*p.parts);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
 assert json.loads((source/'package.json').read_bytes())['version']=='1.0.21-preview.19'
 assert run('npm-ci',['npm.cmd','ci','--ignore-scripts','--no-audit','--no-fund'],900,source)==0
 # Required checks execute on the VM only; all results retained even if one fails.
 for name,cmd in [('core',['npm.cmd','run','test:core']),('browser-preview',['npm.cmd','run','test:browser-preview']),('vite-build',['node','node_modules/vite/bin/vite.js','build','--outDir',str(WORK/'frontend/dist')])]:
  result['checks'][name]=run(name,cmd,900,source)
 assert run('electron-install',['node','node_modules/electron/install.js'],600,source)==0
 for identity in ('synthetic','sample-a','sample-b'):
  native=WORK/('native-'+identity);native.mkdir()
  args=['node',str(HERE/'cloud-jpeg.mjs'),str(source),str(native)]
  if identity!='synthetic':args.append(str(WORK/(identity+'.plain')))
  result['checks']['jpeg-'+identity]=run('jpeg-'+identity,args,900,source)
  import shutil
  shutil.copytree(native/'evidence',EVIDENCE/('native-'+identity))
 result['syntheticOnly']=False;result['originalPhotosTransferred']=True
 changed=[]
 for r in records:
  if sha((source/r['path']).read_bytes())!=r['sha256']:changed.append(r['path'])
 result['sourceChangedByTests']=changed;assert not changed,'FROZEN_SOURCE_CHANGED'
 result['status']='PASS_SOURCE_STAGE' if all(v==0 for v in result['checks'].values()) else 'FAIL_SOURCE_STAGE'
except Exception as e:
 result['status']='FAIL_CONTROLLER';result['error']=str(e);EVIDENCE.mkdir(parents=True,exist_ok=True);(EVIDENCE/'controller-error.log').write_text(traceback.format_exc())
finally:
 save(EVIDENCE/'SUMMARY.json',result)
 # Only ciphertext evidence is exposed to GitHub artifacts.
 encrypted=WORK/'encrypted';encrypted.mkdir(exist_ok=True);archive=WORK/'evidence.zip'
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
  for p in sorted(EVIDENCE.rglob('*')):
   if p.is_file():z.write(p,p.relative_to(EVIDENCE).as_posix())
 rc=run('encrypt-evidence',['node',str(HERE/'cloud-transport.mjs'),'encrypt',str(archive),str(encrypted/'reports.enc'),str(encrypted/'REPORTS_READY.json')],120,private=True)
 print(json.dumps({'status':result['status'],'checks':result['checks'],'sourceTree':TREE,'encryptedEvidenceReady':rc==0}),flush=True)
sys.exit(0 if result['status']=='PASS_SOURCE_STAGE' and rc==0 else 1)

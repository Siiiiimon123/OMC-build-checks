"""Generic encrypted native update build. Product changes are private overlay bytes."""
import datetime,hashlib,json,os,pathlib,platform,plistlib,shutil,stat,subprocess,sys,tarfile,time,traceback,urllib.request,zipfile
from pkg_contract_adapter import build_nonrelocatable_pkg, normalize_install_permissions, verify_expanded_contract
REPO='Siiiiimon123/OMC-build-checks'
AUTH='call_03916fb670c141bfb0565a0fb676b732'
def sha(p):
 with pathlib.Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(p,d):pathlib.Path(p).write_text(json.dumps(d,indent=2)+'\n')
def run(label,args,allow_failure=False,cwd=None):
 with (reports/(label+'.log')).open('wb') as log:r=subprocess.run([str(x) for x in args],stdout=log,stderr=subprocess.STDOUT,env=clean,cwd=cwd)
 report['steps'].append({'label':label,'exit':r.returncode});save(reports/'BUILD.json',report)
 print(json.dumps({'phase':label,'exit':r.returncode}),flush=True)
 if r.returncode and not allow_failure:raise RuntimeError(label+'_FAILED')
 return r.returncode
def inventory(root):
 rows={}
 for p in sorted(pathlib.Path(root).rglob('*')):
  m=p.lstat().st_mode;n=p.relative_to(root).as_posix()
  if stat.S_ISLNK(m):rows[n]={'type':'link','target':os.readlink(p)}
  elif stat.S_ISREG(m):rows[n]={'type':'file','sha256':sha(p),'execute':m&0o111,'bytes':p.stat().st_size}
  elif stat.S_ISDIR(m):rows[n]={'type':'dir'}
  else:raise RuntimeError('NONREGULAR_APP_ENTRY')
 return rows
def api(route,method='GET',data=None):
 req=urllib.request.Request('https://api.github.com/repos/'+REPO+route,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':'application/json'},data=json.dumps(data).encode() if data is not None else None,method=method)
 with urllib.request.urlopen(req,timeout=120) as r:return json.load(r)
def publish(files,suffix=''):
 tag='omc-mac-update17-build-'+os.environ['GITHUB_RUN_ID']+suffix
 release=api('/releases','POST',{'tag_name':tag,'target_commitish':os.environ['GITHUB_SHA'],'name':tag,'draft':False,'prerelease':True,'body':'Encrypted update build and QA-only bootstrap. No plaintext product source or packages.'})
 rows=[]
 for p in files:
  response=p.with_suffix(p.suffix+'.upload.json');url='https://uploads.github.com/repos/'+REPO+'/releases/'+str(release['id'])+'/assets?name='+p.name
  with response.open('wb') as out:
   c=subprocess.run(['curl','--fail','--silent','--config','-','--request','POST','-H','Content-Type: application/octet-stream','--upload-file',str(p),url],input=('header = "Authorization: Bearer '+token+'"\n').encode(),stdout=out,stderr=subprocess.DEVNULL,env=clean)
  assert c.returncode==0
  a=json.loads(response.read_bytes());assert a['size']==p.stat().st_size and a['digest']=='sha256:'+sha(p)
  rows.append({'name':p.name,'id':a['id'],'sha256':sha(p),'bytes':p.stat().st_size,'url':a['browser_download_url']})
 return tag,rows
assert os.environ.get('GITHUB_REPOSITORY')==REPO and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
assert sys.platform=='darwin' and platform.machine()=='arm64'
here=pathlib.Path(__file__).resolve().parent
work=pathlib.Path(os.environ['RUNNER_TEMP'])/'omc-mac-update17-build';work.mkdir(mode=0o700)
reports=work/'private-reports';reports.mkdir(mode=0o700)
key=os.environ.pop('OMC_PREVIEW15_TRANSPORT_KEY');token=os.environ.pop('GH_TOKEN')
assert len(key)==64
clean={**os.environ,'ELECTRON_SKIP_BINARY_DOWNLOAD':'1','CSC_IDENTITY_AUTO_DISCOVERY':'false'}
secret={**clean,'OMC_PREVIEW15_TRANSPORT_KEY':key}
report={'status':'RUNNING','authorization':AUTH,'steps':[],'modelOrRuntimeRebuilt':False,'sourcePubliclyDisclosed':False}
try:
 delta=json.loads((here/'DELTA.json').read_bytes())
 delta['assets'][0]['url']='https://raw.githubusercontent.com/'+REPO+'/'+os.environ['GITHUB_SHA']+'/mac-update17/delta.enc'
 save(work/'FROZEN_DELTA.json',delta)
 for id,manifest,out in [('pkg',here/'BASE.json',work/'base15.pkg'),('delta',work/'FROZEN_DELTA.json',work/'delta.zip')]:
  r=subprocess.run(['node',str(here/'transport.cjs'),'fetch','--manifest',str(manifest),'--id',id,'--output',str(out)],env=secret,stdout=(reports/(id+'-transport.log')).open('wb'),stderr=subprocess.STDOUT);assert r.returncode==0
 private=work/'private';private.mkdir()
 with zipfile.ZipFile(work/'delta.zip') as z:
  for row in z.infolist():
   n=pathlib.PurePosixPath(row.filename);assert not n.is_absolute() and '..' not in n.parts and '\\' not in row.filename and not row.is_dir() and ((row.external_attr>>16)&0o170000)!=0o120000
   p=private.joinpath(*n.parts);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(row))
 assert sha(work/'base15.pkg')=='62d358b5794c7acdf38dd0e91451bb75679047a6cc17f5da67f9c8ba72eef013'
 expanded=work/'expanded15';run('expand-exact-base15',['/usr/sbin/pkgutil','--expand-full',work/'base15.pkg',expanded])
 candidates=[p for p in expanded.rglob('OMC-Preview.app') if p.is_dir() and not p.is_symlink()];assert len(candidates)==1
 output=work/'output';output.mkdir();app=output/'OMC-Preview.app';candidates[0].rename(app)
 before=inventory(app/'Contents/Resources/ai-service')
 source=private/'test-source'
 frozen=json.loads((private/'SOURCE-MANIFEST.json').read_bytes())
 for row in frozen['records']:assert sha(source/row['path'])==row['sha256']
 run('locked-existing-build-tools',['npm','ci','--ignore-scripts','--no-audit','--no-fund'],cwd=source)
 clean['NODE_PATH']=str(source/'node_modules');secret['NODE_PATH']=clean['NODE_PATH']
 run('current-source-core',['npm','run','test:core'],cwd=source)
 run('current-source-update',['node','--test','electron/updateService.test.cjs','electron/updatePolicy.test.cjs','electron/macUpdateInstaller.test.cjs','electron/macUpdateMainHandoff.test.cjs','src/services/updateUiState.test.js'],cwd=source)
 run('current-source-browser',['npm','run','test:browser-preview'],cwd=source)
 run('current-source-build',['npm','run','build:browser-preview'],cwd=source)
 overlay=json.loads((private/'OVERLAY.json').read_bytes())
 assert not any(row['path'].startswith('dist/') for row in overlay['files'])
 for f in sorted((source/'dist').rglob('*')):
  if f.is_file():
   relative='dist/'+f.relative_to(source/'dist').as_posix();dest=private/'app'/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,dest)
   overlay['files'].append({'path':relative,'bytes':f.stat().st_size,'sha256':sha(f)})
 save(private/'OVERLAY.json',overlay);save(reports/'NATIVE_COMPILED_OVERLAY.json',overlay)
 run('generate-synthetic-fixture',[sys.executable,here/'make_fixture.py',work/'fixture.jpg'])
 packages=[]
 for mode,version in [('final','1.0.21-preview.17'),('qa','1.0.21-preview.16')]:
  run('apply-'+mode,['node',here/'apply-archive.cjs',app,private,version,mode,work])
  info=app/'Contents/Info.plist';d=plistlib.loads(info.read_bytes());d['CFBundleShortVersionString']=version;d['CFBundleVersion']='1.0.21.'+('17' if mode=='final' else '16')
  h=json.loads((work/('ARCHIVE_'+mode+'.json')).read_bytes())['asarHeaderSha256']
  if 'ElectronAsarIntegrity' in d:
   assert 'Resources/app.asar' in d['ElectronAsarIntegrity'];d['ElectronAsarIntegrity']['Resources/app.asar']={'algorithm':'SHA256','hash':h}
  info.write_bytes(plistlib.dumps(d));normalize_install_permissions(app,reports/('PERMISSIONS_'+mode+'.json'))
  # Outer sealing only: never re-sign hash-bound native vendor libraries.
  run('seal-outer-'+mode,['/usr/bin/codesign','--force','--sign','-',app]);run('verify-seal-'+mode,['/usr/bin/codesign','--verify','--deep','--strict',app])
  assert inventory(app/'Contents/Resources/ai-service')==before,'NATIVE_RUNTIME_RESOURCE_CHANGED'
  package=work/('final17.pkg' if mode=='final' else 'qa-bootstrap16.pkg')
  packagework=work/('packaging-'+mode);packagework.mkdir()
  pd=reports/mode;pd.mkdir();build_nonrelocatable_pkg(app,packagework,package,run,pd)
  verifydir=work/('verify-'+mode);run('expand-'+mode,['/usr/sbin/pkgutil','--expand-full',package,verifydir]);verify_expanded_contract(verifydir,pd)
  targets=[p for p in verifydir.rglob('OMC-Preview.app') if p.is_dir() and not p.is_symlink()];assert len(targets)==1 and inventory(targets[0])==inventory(app),'PKG_READBACK_CHANGED'
  save(pd/'PAYLOAD_READBACK.json',{'status':'PASS','allRegularBytesSymlinkTargetsExecuteBitsCompared':True,'pkgSha256':sha(package),'pkgBytes':package.stat().st_size})
  shutil.rmtree(verifydir)
  if mode=='final':
   run('install-final17',['sudo','/usr/sbin/installer','-pkg',package,'-target','/'])
   assert inventory(pathlib.Path('/Applications/OMC-Preview.app'))==inventory(app)
   run('normal-installed-final17',['node',private/'normal-acceptance.mjs','/Applications/OMC-Preview.app',reports/'NORMAL_FINAL17.json',work/'fixture.jpg'])
  packages.append((mode,package))
 report['status']='PASS_BUILD_PACKAGE_READBACK_INSTALL_AND_NORMAL_ENTRY';save(reports/'BUILD.json',report)
 # Bootstrap differs only in test version and QA URL; never member delivery.
 files=[];assets=[]
 for mode,package in packages:
  enc=work/(mode+'.enc');mf=work/(mode+'-transport.json')
  r=subprocess.run(['node',str(here/'transport.cjs'),'encrypt','--input',str(package),'--output',str(enc),'--id',mode,'--manifest',str(mf)],env=secret,stdout=subprocess.DEVNULL);assert r.returncode==0
  files.append(enc);assets.append(json.loads(mf.read_bytes())['assets'][0])
 with tarfile.open(work/'reports.tar','w') as t:t.add(reports,arcname='reports')
 enc=work/'reports.enc';mf=work/'reports-transport.json'
 r=subprocess.run(['node',str(here/'transport.cjs'),'encrypt','--input',str(work/'reports.tar'),'--output',str(enc),'--id','reports','--manifest',str(mf)],env=secret,stdout=subprocess.DEVNULL);assert r.returncode==0
 files.append(enc);assets.append(json.loads(mf.read_bytes())['assets'][0])
 tag,published=publish(files)
 for a in assets:a['url']=next(x['url'] for x in published if x['name']==a['id']+'.enc')
 manifest={'schema':'omc-aes256gcm-build-transport-v1','assets':assets,'version':'1.0.21-preview.17','status':report['status'],'runId':os.environ['GITHUB_RUN_ID'],'authorization':AUTH,'qaBootstrapForTestingOnly':True}
 save(here/'PUBLIC_RESULT.json',manifest)
 # Upload public metadata into the same release using the same bounded publisher logic.
 out=work/'OUTPUTS.json';save(out,manifest)
 releases=api('/releases/tags/'+tag);url='https://uploads.github.com/repos/'+REPO+'/releases/'+str(releases['id'])+'/assets?name=OUTPUTS.json'
 req=urllib.request.Request(url,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},data=out.read_bytes(),method='POST')
 with urllib.request.urlopen(req,timeout=120) as response:meta=json.load(response)
 assert meta['digest']=='sha256:'+sha(out)
 with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write('manifest_url='+meta['browser_download_url']+'\n')
 print(json.dumps({'status':report['status'],'manifestURL':meta['browser_download_url'],'finalSha256':assets[0]['plaintextSha256'],'finalBytes':assets[0]['plaintextBytes']}),flush=True)
except BaseException:
 report['status']='FAIL';save(reports/'BUILD.json',report);(reports/'FAILURE.txt').write_text(traceback.format_exc())
 try:
  with tarfile.open(work/'failure-reports.tar','w') as t:t.add(reports,arcname='reports')
  enc=work/'failure-reports.enc';mf=work/'failure-transport.json'
  r=subprocess.run(['node',str(here/'transport.cjs'),'encrypt','--input',str(work/'failure-reports.tar'),'--output',str(enc),'--id','reports','--manifest',str(mf)],env=secret,stdout=subprocess.DEVNULL);assert r.returncode==0
  tag,files=publish([enc],'-failure');a=json.loads(mf.read_bytes())['assets'][0];a['url']=files[0]['url']
  public=here/'PUBLIC_RESULT.json';save(public,{'status':'FAIL','schema':'omc-aes256gcm-build-transport-v1','assets':[a],'steps':report['steps']})
 except BaseException:pass
 print('NATIVE_BUILD_FAILED_ENCRYPTED_EVIDENCE_ATTEMPTED',flush=True);raise SystemExit(1)

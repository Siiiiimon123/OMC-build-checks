"""Generic actual upgrade acceptance. Detailed data remains encrypted."""
import hashlib,json,os,pathlib,platform,subprocess,sys,tarfile,traceback,urllib.request,zipfile
REPO='Siiiiimon123/OMC-build-checks'
assert os.environ.get('GITHUB_REPOSITORY')==REPO and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
assert sys.platform=='darwin' and platform.machine()=='arm64'
here=pathlib.Path(__file__).resolve().parent;work=pathlib.Path(os.environ['RUNNER_TEMP'])/'omc-mac-update17-upgrade';work.mkdir(mode=0o700)
reports=work/'private-reports';reports.mkdir(mode=0o700)
key=os.environ.pop('OMC_PREVIEW15_TRANSPORT_KEY');token=os.environ.pop('GH_TOKEN')
clean=dict(os.environ);secret={**clean,'OMC_PREVIEW15_TRANSPORT_KEY':key};report={'status':'RUNNING','steps':[],'authorization':'call_a4156b1b23d3426bb6a6821ec7429ac8'}
def sha(p):
 with pathlib.Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(p,d):pathlib.Path(p).write_text(json.dumps(d,indent=2)+'\n')
def run(label,args):
 with (reports/(label+'.log')).open('wb') as out:r=subprocess.run([str(a) for a in args],env=clean,stdout=out,stderr=subprocess.STDOUT)
 report['steps'].append({'label':label,'exit':r.returncode});print(json.dumps({'phase':label,'exit':r.returncode}),flush=True)
 if r.returncode:raise RuntimeError(label+'_FAILED')
def api(route,data):
 req=urllib.request.Request('https://api.github.com/repos/'+REPO+route,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':'application/json'},data=json.dumps(data).encode(),method='POST')
 with urllib.request.urlopen(req,timeout=120) as r:return json.load(r)
status=1
try:
 with urllib.request.urlopen(os.environ['BUILD_MANIFEST_URL'],timeout=120) as response:manifest=json.load(response)
 assert manifest['status']=='PASS_BUILD_PACKAGE_READBACK_INSTALL_AND_NORMAL_ENTRY'
 mf=work/'BUILD_OUTPUTS.json';save(mf,manifest)
 delta=json.loads((here/'DELTA.json').read_bytes());delta['assets'][0]['url']='https://raw.githubusercontent.com/'+REPO+'/'+os.environ['GITHUB_SHA']+'/mac-update17/delta.enc';save(work/'FROZEN_DELTA.json',delta)
 for id,source,out in [('qa',mf,work/'qa-bootstrap16.pkg'),('delta',work/'FROZEN_DELTA.json',work/'delta.zip')]:
  with (reports/(id+'-transport.log')).open('wb') as log:
   r=subprocess.run(['node',str(here/'transport.cjs'),'fetch','--manifest',str(source),'--id',id,'--output',str(out)],env=secret,stdout=log,stderr=subprocess.STDOUT);assert r.returncode==0
 private=work/'private';private.mkdir()
 with zipfile.ZipFile(work/'delta.zip') as z:
  for row in z.infolist():
   n=pathlib.PurePosixPath(row.filename);assert not n.is_absolute() and '..' not in n.parts and '\\' not in row.filename and not row.is_dir() and ((row.external_attr>>16)&0o170000)!=0o120000
   p=private.joinpath(*n.parts);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(row))
 final=next(a for a in manifest['assets'] if a['id']=='final')
 run('install-qa-client16',['sudo','/usr/sbin/installer','-pkg',work/'qa-bootstrap16.pkg','-target','/'])
 run('make-generated-fixture',[sys.executable,here/'make_fixture.py',work/'fixture.jpg'])
 run('actual-upgrade-flow',['node',private/'upgrade-acceptance.mjs','/Applications/OMC-Preview.app',work/'fixture.jpg',reports/'UPGRADE.json',final['plaintextSha256']])
 actual=json.loads((reports/'UPGRADE.json').read_bytes());assert actual['status']=='PASS_ACTUAL_SIGNED_DOWNLOAD_OS_HANDOFF_INSTALL_REOPEN_AND_PROJECT_PRESERVATION'
 run('normal-final17-after-upgrade',['node',private/'normal-acceptance.mjs','/Applications/OMC-Preview.app',reports/'NORMAL_AFTER_UPGRADE.json',work/'fixture.jpg'])
 report['status']='PASS_NATIVE_UPDATE_DOWNLOAD_OS_HANDOFF_INSTALL_PROJECT_REOPEN_AND_FULL_AI';report['finalSha256']=final['plaintextSha256'];status=0
except BaseException:
 report['status']='FAIL';(reports/'FAILURE.txt').write_text(traceback.format_exc())
finally:
 save(reports/'RESULT.json',report)
 try:
  with tarfile.open(work/'reports.tar','w') as t:t.add(reports,arcname='reports')
  mf=work/'REPORTS_TRANSPORT.json';enc=work/'reports.enc'
  r=subprocess.run(['node',str(here/'transport.cjs'),'encrypt','--input',str(work/'reports.tar'),'--output',str(enc),'--id','reports','--manifest',str(mf)],env=secret,stdout=subprocess.DEVNULL);assert r.returncode==0
  tag='omc-mac-update17-upgrade-'+os.environ['GITHUB_RUN_ID'];release=api('/releases',{'tag_name':tag,'target_commitish':os.environ['GITHUB_SHA'],'name':tag,'draft':False,'prerelease':True,'body':'Encrypted native update evidence only.'})
  url='https://uploads.github.com/repos/'+REPO+'/releases/'+str(release['id'])+'/assets?name=reports.enc';response=work/'UPLOAD.json'
  with response.open('wb') as out:r=subprocess.run(['curl','--fail','--silent','--config','-','--request','POST','-H','Content-Type: application/octet-stream','--upload-file',str(enc),url],input=('header = "Authorization: Bearer '+token+'"\n').encode(),stdout=out,stderr=subprocess.DEVNULL,env=clean)
  assert r.returncode==0;a=json.loads(response.read_bytes());assert a['digest']=='sha256:'+sha(enc)
  entry=json.loads(mf.read_bytes())['assets'][0];entry['url']=a['browser_download_url']
  save(here/'PUBLIC_UPGRADE_RESULT.json',{'schema':'omc-aes256gcm-build-transport-v1','status':report['status'],'assets':[entry],'steps':report['steps'],'finalSha256':report.get('finalSha256'),'systemInstallerConsentAutomated':False})
 except BaseException:print('ENCRYPTED_EVIDENCE_UPLOAD_FAILED',flush=True);status=1
print(json.dumps({'status':report['status'],'steps':report['steps']}),flush=True);raise SystemExit(status)

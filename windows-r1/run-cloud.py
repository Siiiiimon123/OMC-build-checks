"""Generic bounded orchestration; private inputs and reports stay encrypted."""
import hashlib,json,os,platform,shutil,subprocess,sys,tarfile,time,traceback,urllib.request,zipfile
from pathlib import Path,PurePosixPath

REPO='Siiiiimon123/OMC-build-checks'
SOURCE='cb0aaee04d7a99e4b175e2b8b039a23afec85006'
SCOPE_SHA='c1ffa8b886670143b58d75f261c23896e4f8b6554705e58eb73c953c534ade2c'
PLAN_SHA='2c58d5d7c74d4fb4112f31cffe4563ac2e0195a032d8da6a994ad23b75d2c1f1'
ZIP_SHA='c5799c658e23ce5684416c5f3066a1de2c19795ff30e43c436daa26a5e01dc2d'
BASE_SHA='9eda59434c38b50085edd041dd9a7b06e2476e6a99cc0e3c3a7c353695f9703d'
BASE_URL='https://omc.xiaoa.cyou/updates/targets/releases/'+BASE_SHA+'.OMC-Photo-Select-1.0.21-preview.16-x64.exe'

def sha(p):
 with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(p,v):Path(p).write_text(json.dumps(v,indent=2)+'\n',encoding='utf8')
def phase(name):print(json.dumps({'phase':name}),flush=True)
def safe(name):
 p=PurePosixPath(name)
 assert name and not p.is_absolute() and '\\' not in name and ':' not in name and all(x not in ('','.','..') for x in name.split('/'))
 return p.parts
def extract_tar(archive,root):
 with tarfile.open(archive) as t:
  rows=t.getmembers();assert len(rows)==46 and len({r.name.lower() for r in rows})==len(rows)
  assert sum(r.size for r in rows)==41131212
  for r in rows:assert r.isfile() and not r.issym() and not r.islnk();safe(r.name)
  root.mkdir()
  for r in rows:
   p=root.joinpath(*safe(r.name));p.parent.mkdir(parents=True,exist_ok=True)
   with t.extractfile(r) as f,p.open('xb') as out:shutil.copyfileobj(f,out)
def extract_source(archive,root,expected):
 assert sha(archive)==ZIP_SHA
 with zipfile.ZipFile(archive) as z:
  rows=z.infolist();assert len(rows)==931 and len({r.filename for r in rows})==931
  by={r['path']:r for r in expected};assert set(by)=={r.filename for r in rows}
  root.mkdir()
  for r in rows:
   assert not r.is_dir() and ((r.external_attr>>16)&0o170000)!=0o120000
   p=root.joinpath(*safe(r.filename));p.parent.mkdir(parents=True,exist_ok=True);b=z.read(r)
   assert len(b)==by[r.filename]['bytes'] and hashlib.sha256(b).hexdigest()==by[r.filename]['sha256']
   with p.open('xb') as f:f.write(b)
def download(url,path,length,digest):
 h=hashlib.sha256();count=0;deadline=time.monotonic()+2400
 with urllib.request.urlopen(url,timeout=90) as response,path.open('xb') as out:
  assert response.url==url
  while True:
   b=response.read(1024*1024)
   if not b:break
   count+=len(b);assert count<=length and time.monotonic()<deadline;h.update(b);out.write(b)
 assert count==length and h.hexdigest()==digest
def api(token,suffix,method='GET',data=None):
 req=urllib.request.Request('https://api.github.com/repos/'+REPO+suffix,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':'application/json'},method=method,data=json.dumps(data).encode() if data is not None else None)
 with urllib.request.urlopen(req,timeout=120) as response:return json.load(response)
def publish(token,files,tag,release_id=None):
 r={'id':release_id} if release_id else api(token,'/releases','POST',{'tag_name':tag,'name':tag,'target_commitish':os.environ['GITHUB_SHA'],'draft':False,'prerelease':True,'body':'Authenticated encrypted build outputs; no plaintext product files.'})
 for p in files:
  assert p.stat().st_size<2*1024**3
  url='https://uploads.github.com/repos/'+REPO+'/releases/'+str(r['id'])+'/assets?name='+p.name
  config='header = "Authorization: Bearer '+token+'"\n'
  result=p.with_suffix(p.suffix+'.upload.json')
  with result.open('wb') as out:
   cp=subprocess.run(['curl.exe','--fail','--silent','--config','-','--request','POST','-H','Content-Type: application/octet-stream','--upload-file',str(p),url],input=config.encode(),stdout=out,stderr=subprocess.DEVNULL,timeout=600)
  assert cp.returncode==0;a=json.loads(result.read_bytes());assert a['state']=='uploaded' and a['size']==p.stat().st_size and a['digest']=='sha256:'+sha(p)
 return {'releaseId':r['id'],'tag':tag}

def main():
 assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')==REPO
 assert os.environ.get('GITHUB_REF')=='refs/heads/verify-windows-r1-18' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
 assert os.environ.get('RUNNER_OS')=='Windows' and os.environ.get('RUNNER_ARCH')=='X64' and platform.system()=='Windows'
 assert os.environ.get('OMC_R1_AUTHORIZATION_ID')=='user-r1-execution-20261101'
 # Git Windows checkout may change CRLF; only this frozen JSON text hashes canonical LF.
 # All archive/source/model/artifact SHA checks remain raw byte checks.
 here=Path(__file__).resolve().parent;scope_bytes=(here/'R1_EXECUTION_SCOPE.public.json').read_bytes();assert hashlib.sha256(scope_bytes.replace(b'\r\n',b'\n')).hexdigest()==SCOPE_SHA,'EXECUTION_SCOPE_TEXT_SHA'
 scope=json.loads(scope_bytes);assert scope['sourceTreeWindows']==SOURCE and scope['limits']['feeUSD']==0 and scope['limits']['windowsRuns']==13 and scope['limits']['windowsMinutesEach']==60 and scope['limits']['automaticRerun'] is False and scope['executed']['windows']==12 and scope['remaining']['windows']==1 and scope['windowsEolSupplementalApproval']['questionItemId']=='call_be127aa5d6874d618736fc7d3bd509ca' and scope['windowsFifthSupplementalApproval']['maximumTotalRuns']==5 and scope['windowsSixthSupplementalApproval']['maximumTotalRuns']==6 and scope['windowsSixthSupplementalApproval']['productTree']=='cb0aaee04d7a99e4b175e2b8b039a23afec85006' and scope['windowsSeventhSupplementalApproval']['maximumTotalRuns']==7 and scope['windowsSeventhSupplementalApproval']['productTree']=='cb0aaee04d7a99e4b175e2b8b039a23afec85006' and scope['windowsEighthSupplementalApproval']['maximumTotalRuns']==8 and scope['windowsEighthSupplementalApproval']['productTree']=='cb0aaee04d7a99e4b175e2b8b039a23afec85006' and scope['windowsNinthSupplementalApproval']['maximumTotalRuns']==9 and scope['windowsNinthSupplementalApproval']['productTree']=='cb0aaee04d7a99e4b175e2b8b039a23afec85006' and scope['windowsNinthSupplementalApproval']['approvedAtAsiaShanghai']=='2026-11-03T07:45:00+08:00' and scope['windowsNinthSupplementalApproval']['cloudDispatchAuthorized'] is True and scope['windowsTenthSupplementalApproval']['maximumTotalRuns']==10 and scope['windowsTenthSupplementalApproval']['productTree']=='cb0aaee04d7a99e4b175e2b8b039a23afec85006' and scope['windowsTenthSupplementalApproval']['approvedAtAsiaShanghai']=='2026-11-03T10:00:00+08:00' and scope['windowsTenthSupplementalApproval']['cloudDispatchAuthorized'] is True and scope['windowsEleventhSupplementalApproval']['maximumTotalRuns']==11 and scope['windowsEleventhSupplementalApproval']['productTree']==SOURCE and scope['windowsEleventhSupplementalApproval']['approvedAtAsiaShanghai']=='2026-11-03T11:01:00+08:00' and scope['windowsEleventhSupplementalApproval']['cloudDispatchAuthorized'] is True and scope['windowsTwelfthSupplementalApproval']['maximumTotalRuns']==12 and scope['windowsTwelfthSupplementalApproval']['productTree']==SOURCE and scope['windowsTwelfthSupplementalApproval']['approvedAtAsiaShanghai']=='2026-11-03T12:03:00+08:00' and scope['windowsTwelfthSupplementalApproval']['cloudDispatchAuthorized'] is True and scope['windowsThirteenthSupplementalApproval']['maximumTotalRuns']==13 and scope['windowsThirteenthSupplementalApproval']['productTree']==SOURCE and scope['windowsThirteenthSupplementalApproval']['approvedAtAsiaShanghai']=='2026-11-03T13:28:00+08:00' and scope['windowsThirteenthSupplementalApproval']['verbatim']=='批准第十三次 Windows 验收：先修好照片编号为空也算通过的漏洞，合并 PR #4 和批准一起推送，预检通过就启动' and scope['windowsThirteenthSupplementalApproval']['cloudDispatchAuthorized'] is True
 if os.environ.get('OMC_R1_GATE_ONLY')=='1':
  print(json.dumps({'phase':'gate-only-pass','controller':'run-cloud.py','scopeSha':SCOPE_SHA,'sourceTree':SOURCE,'windowsRuns':scope['limits']['windowsRuns'],'executedWindows':scope['executed']['windows'],'remainingWindows':scope['remaining']['windows'],'thirteenthApprovedAt':scope['windowsThirteenthSupplementalApproval']['approvedAtAsiaShanghai'],'cloudDispatchAuthorized':scope['windowsThirteenthSupplementalApproval']['cloudDispatchAuthorized']}),flush=True)
  return
 key=os.environ.pop('OMC_PREVIEW15_TRANSPORT_KEY');token=os.environ.pop('GH_TOKEN');assert len(key)==64
 clean=dict(os.environ);secret={**clean,'OMC_PREVIEW15_TRANSPORT_KEY':key,'GH_TOKEN':token,'GITHUB_TOKEN':token}
 temp=Path(os.environ['RUNNER_TEMP']).resolve();work=temp/'omc-r1-controller';assert not work.exists();work.mkdir()
 assert shutil.disk_usage(work).free>12*1024**3
 detail=work/'reports';detail.mkdir();out=work/'encrypted';out.mkdir();helper=here/'transport.cjs';package=None;status=1
 def run(args,name,timeout,cwd=None,env=clean):
  started=time.monotonic()
  with (detail/name).open('wb') as log:
   proc=subprocess.Popen([str(x) for x in args],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT)
   try:
    code=proc.wait(timeout=timeout)
    if code:raise subprocess.CalledProcessError(code,args)
   except subprocess.TimeoutExpired:
    # Diagnostic failures must never bypass cleanup of this launched QA tree.
    snapshot={'step':name,'pid':proc.pid,'timeoutSeconds':timeout,'elapsedSeconds':round(time.monotonic()-started,3),'artifacts':[],'cleanupScope':'exact launched root plus observed descendants with matching start time','allDescendantsCertified':False};observed=[]
    try:
     ps='$rows=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name);$ids=[System.Collections.Generic.HashSet[int]]::new();[void]$ids.Add('+str(proc.pid)+');do{$changed=$false;foreach($row in $rows){if($ids.Contains([int]$row.ParentProcessId)){$changed=$ids.Add([int]$row.ProcessId) -or $changed}}}while($changed);$out=@(foreach($row in $rows){if($ids.Contains([int]$row.ProcessId)){try{$p=Get-Process -Id $row.ProcessId -ErrorAction Stop;[pscustomobject]@{pid=[int]$row.ProcessId;parent=[int]$row.ParentProcessId;name=$row.Name;startTicks=$p.StartTime.ToUniversalTime().Ticks.ToString();cpuSeconds=$p.TotalProcessorTime.TotalSeconds}}catch{}}});ConvertTo-Json -InputObject $out -Compress'
     cp=subprocess.run(['pwsh','-NoProfile','-Command',ps],capture_output=True,timeout=15,env=clean)
     snapshot['processMetadataExitCode']=cp.returncode
     if cp.returncode==0:
      candidate=json.loads(cp.stdout[:65536].decode('utf8'))
      assert isinstance(candidate,list) and len(candidate)<=128
      for row in candidate:assert isinstance(row['pid'],int) and row['pid']>0 and isinstance(row['startTicks'],str) and row['startTicks'].isdigit()
      observed=candidate;snapshot['ownedProcessMetadata']=observed
     build=temp/'omc-r1-build'
     for directory in [build,build/'artifacts']:
      try:
       if not directory.is_dir():continue
       for p in sorted(directory.iterdir()):
        try:
         if p.is_file() and not p.is_symlink():snapshot['artifacts'].append({'path':str(p.relative_to(build)),'bytes':p.stat().st_size})
        except OSError:snapshot.setdefault('artifactInspectionErrors',[]).append(str(p.relative_to(build)))
      except OSError:snapshot.setdefault('artifactDirectoryInspectionErrors',[]).append(str(directory))
     save(detail/(name+'.timeout.json'),snapshot)
    except Exception as error:snapshot['diagnosticError']=type(error).__name__
    finally:
     try:
      if proc.poll() is None:
       try:
        cp=subprocess.run(['taskkill.exe','/PID',str(proc.pid),'/T','/F'],stdout=log,stderr=subprocess.STDOUT,timeout=15,env=clean);snapshot['ownedTreeTerminationExitCode']=cp.returncode
       except Exception as error:snapshot['ownedTreeTerminationError']=type(error).__name__
      else:snapshot['ownedRootExitedBeforeTermination']=True
      # A root exit does not prove its already-observed children have exited.
      # Match each observed PID AND creation time before terminating/readback.
      if observed:
       literals=','.join("@{pid="+str(r['pid'])+";startTicks='"+r['startTicks']+"'}" for r in observed)
       cleanup="$expected=@("+literals+");$stopped=@();foreach($r in $expected){try{$p=Get-Process -Id $r.pid -ErrorAction Stop;if($p.StartTime.ToUniversalTime().Ticks.ToString() -ceq $r.startTicks){Stop-Process -InputObject $p -Force -ErrorAction Stop;$stopped+=$r.pid}}catch{}};$end=[DateTime]::UtcNow.AddSeconds(5);do{$remaining=@(foreach($r in $expected){try{$p=Get-Process -Id $r.pid -ErrorAction Stop;if($p.StartTime.ToUniversalTime().Ticks.ToString() -ceq $r.startTicks){$r.pid}}catch{}});if(!$remaining.Count){break};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $end);ConvertTo-Json -Compress -InputObject @{stopped=$stopped;remaining=$remaining}"
       cp=subprocess.run(['pwsh','-NoProfile','-Command',cleanup],capture_output=True,timeout=15,env=clean);snapshot['observedCleanupExitCode']=cp.returncode
       if cp.returncode==0:snapshot['observedCleanup']=json.loads(cp.stdout[:65536].decode('utf8'))
     except Exception as error:snapshot['observedCleanupError']=type(error).__name__
     finally:
      try:
       if proc.poll() is None:proc.kill()
       proc.wait(timeout=10)
      except Exception as error:snapshot['rootReapError']=type(error).__name__
      try:save(detail/(name+'.timeout.json'),snapshot)
      except Exception:pass
    raise
   finally:
    try:save(detail/(name+'.timing.json'),{'step':name,'pid':proc.pid,'exitCode':proc.poll(),'elapsedSeconds':round(time.monotonic()-started,3),'limitSeconds':timeout})
    except Exception:pass

 try:
  phase('authenticated-compact-input')
  # transport's overall download budget is 275 seconds; allow 25 seconds for
  # startup and orderly cleanup without changing any other stage timeout.
  archive=work/'input.tar';run(['node',helper,'fetch','--manifest',here/'INPUT.json','--id','r1-windows','--output',archive],'transport.log',300,env=secret)
  assert archive.stat().st_size==41175040 and sha(archive)=='f9d4142640375c69ba13a0ed8c44550a83522d7b26abe84b9a0d367a82d00daf'
  payload=work/'payload';extract_tar(archive,payload);assert sha(payload/'PLAN.json')==PLAN_SHA
  sm=json.loads((payload/'source-inputs.json').read_bytes());expected=sm['records'] if isinstance(sm,dict) else sm
  extract_source(payload/'source.zip',payload/'source',expected)
  phase('locked-build-tools-only')
  run([os.environ['ComSpec'],'/d','/c','npm.cmd','ci','--ignore-scripts','--no-audit','--no-fund'],'npm.log',420,cwd=payload/'source')
  phase('released16-baseline-download')
  base=work/'released16.exe';download(BASE_URL,base,848245530,BASE_SHA)
  build=temp/'omc-r1-build'
  phase('build-and-full-payload-verification')
  run(['node',here/'cloud-build.cjs','--payload',payload,'--plan-sha256',PLAN_SHA,'--base-installer',base,'--work',build],'build.log',900)
  result=json.loads((build/'BUILD_RESULT.json').read_bytes());assert result['status']=='PASS_SCOPED_BUILD_AND_ALL_PACKAGED_MEMBERS_NOT_INSTALLED'
  current=result['current'];package=Path(current['path']);assert package.is_relative_to(build) and package.stat().st_size==current['bytes'] and sha(package)==current['sha256']
  for name in ['BUILD_RESULT.json','PACKAGE_INPUTS.json','BUILD_CONFIG.json','BASE_APP_MEMBERS.json']:shutil.copyfile(build/name,detail/name)
  # Disposable generated build App only: all bytes are already verified in the
  # exact installer. Keep manifest/package, free this sole App before install.
  app=Path(result['fullApp']);assert app.resolve()==build/'fullApp' and app.is_dir() and not app.is_symlink() and app.is_relative_to(temp)
  save(detail/'BUILD_APP_RECLAIM.json',{'path':str(app),'reason':'sole generated build tree after complete installer CRC/readback; installer retained','userFilesTouched':False})
  shutil.rmtree(app)
  phase('first-install-and-released16-upgrade')
  run(['pwsh','-NoProfile','-File',here/'Run-CleanAndUpgrade.ps1','-InputsPath',build/'PACKAGE_INPUTS.json','-BuiltCurrentInstaller',package,'-BuiltPreviousInstaller',base],'install-upgrade.log',600)
  rr=temp/'WINDOWS_R1_RESULT.json';assert rr.is_file();v=json.loads(rr.read_bytes());assert v['status']=='PASS_SCOPED_CLEAN18_AND_REAL_RELEASED16_TO18_INSTALLER_UPGRADE_SYNTHETIC_PROJECT_AI_EXIT'
  shutil.copyfile(rr,detail/rr.name);status=0
 except Exception:
  (detail/'FAILURE.txt').write_text(traceback.format_exc(),encoding='utf8');phase('bounded-job-failed')
 # Preserve bounded diagnostic files even if build exits before its final result.
 build=temp/'omc-r1-build'
 for name in ['BUILD_CONFIG.json','BUILD_PROGRESS.jsonl','BUILD_RESULT.json']:
  p=build/name
  if p.is_file() and not p.is_symlink() and p.stat().st_size<2*1024**2 and not (detail/name).exists():shutil.copyfile(p,detail/name)
 for name in ['omc-first-install-report.json','CLEAN_NATIVE_AI.json','UPGRADE16_SEED.json','UPGRADE18_RESTORED.json','CLEAN_NATIVE_AI.json.png','UPGRADE16_SEED.json.png','UPGRADE18_RESTORED.json.png','WINDOWS_R1_RESULT.json']:
  p=temp/name
  if p.is_file() and not p.is_symlink():
   assert p.stat().st_size<8*1024**2
   if not (detail/name).exists():shutil.copyfile(p,detail/name)
 tag='omc-windows-r1-encrypted-result-'+os.environ['GITHUB_RUN_ID'];package_asset=None;encrypted_package=None
 if status==0:
  try:
   p=out/'package.enc';m=out/'package.json';run(['node',helper,'encrypt','--input',package,'--output',p,'--id','pkg','--manifest',m],'encrypt-package.log',180,env=secret)
   package_asset=json.loads(m.read_bytes())['assets'][0];encrypted_package=p
  except Exception:
   status=1;(detail/'PACKAGE_ENCRYPT_FAILURE.txt').write_text(traceback.format_exc(),encoding='utf8')
 reports=work/'reports.tar'
 with tarfile.open(reports,'w') as t:
  t.add(detail,arcname='reports')
  build=temp/'omc-r1-build'
  if (build/'BUILD_RESULT.json').is_file():t.add(build/'BUILD_RESULT.json',arcname='build/BUILD_RESULT.json')
 p=out/'reports.enc';m=out/'reports.json'
 # This log is outside the already-created archive.
 with (work/'encrypt-reports.log').open('wb') as log:subprocess.run(['node',str(helper),'encrypt','--input',str(reports),'--output',str(p),'--id','reports','--manifest',str(m)],env=secret,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=120)
 assets=json.loads(m.read_bytes())['assets']
 for a in assets:a['url']='https://github.com/'+REPO+'/releases/download/'+tag+'/reports.enc'
 save(out/'REPORTS_READY.json',{'schema':'omc-aes256gcm-build-transport-v1','assets':assets,'sourceTree':SOURCE,'packageUploadPending':encrypted_package is not None})
 phase('publish-encrypted-reports-first');receipt=publish(token,[p,out/'REPORTS_READY.json'],tag)
 if encrypted_package is not None:
  try:
   phase('publish-encrypted-package');publish(token,[encrypted_package],tag,receipt['releaseId'])
   package_asset['url']='https://github.com/'+REPO+'/releases/download/'+tag+'/package.enc';assets.append(package_asset)
  except Exception:
   status=1;phase('package-upload-failed-reports-retained')
 output=out/'OUTPUTS.json';save(output,{'schema':'omc-aes256gcm-build-transport-v1','assets':assets,'sourceTree':SOURCE,'runId':os.environ['GITHUB_RUN_ID'],'buildExitCode':status,'memberCatalogChanged':False,'wizardClicksTested':False,'bareWindowsQualified':False,'inAppTufUpdateTested':False})
 publish(token,[output],tag,receipt['releaseId']);print(json.dumps(receipt),flush=True);return status
if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception as error:
  frames=traceback.extract_tb(error.__traceback__)
  print(json.dumps({'phase':'controller-failed','exitCode':1,'failureCategory':'EXECUTION_SCOPE_TEXT_SHA' if isinstance(error,AssertionError) and error.args==('EXECUTION_SCOPE_TEXT_SHA',) else type(error).__name__,'sourceLine':frames[-1].lineno if frames else None}),flush=True)
  raise SystemExit(1)

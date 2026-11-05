"""Single free cloud network comparison. No secrets, photos, source or package downloads."""
import datetime, hashlib, json, os, platform, re, subprocess
from pathlib import Path

HOST='omc.xiaoa.cyou'
# Frozen published installer identity; only the first 1024 bytes are read.
TARGET='/updates/targets/releases/9eda59434c38b50085edd041dd9a7b06e2476e6a99cc0e3c3a7c353695f9703d.OMC-Photo-Select-1.0.21-preview.16-x64.exe'
REPO='Siiiiimon123/OMC-build-checks'
BRANCH='refs/heads/verify-cdn-origin-09'
OUT=Path(os.environ['RUNNER_TEMP'])/'omc-cdn-origin-09'
SAFE_HEADERS={'server','content-length','content-range','x-cache','via','x-swift-error','eagleid','x-omc-delivery'}
assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')==REPO
assert os.environ.get('GITHUB_REF')==BRANCH and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
assert platform.system()=='Linux'
event=json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
assert event['repository']['private'] is False
scope=json.loads((Path(__file__).resolve().parent/'EXECUTION_SCOPE.json').read_text())
assert scope['executeAuthorized'] is True and scope['maxRuns']==1 and scope['costLimitUSD']==0
OUT.mkdir(exist_ok=False)
version=subprocess.check_output(['curl','--version'],text=True).splitlines()[0]
v=re.search(r'curl (\d+)\.(\d+)\.(\d+)',version)
assert v and tuple(map(int,v.groups()))>=(8,4,0),'CURL_STREAM_SIZE_GUARD_REQUIRED'
run=os.environ['GITHUB_RUN_ID']
report={'schema':'omc-independent-cloud-origin-comparison-v1','runId':run,'curl':version,
 'network':'GitHub standard Ubuntu runner, independent of owned ECS',
 'targetVersion':'Windows16 published target; not a final release acceptance',
 'productionChanged':False,'installerBytesPersistedAsArtifact':False,'rows':[]}
for label,ip,tls in [('origin-tls12','121.40.126.51','1.2'),('origin-tls13','121.40.126.51','1.3'),('cdn-default','58.218.208.16',None)]:
 query='omc_diag=20261105-gh09-'+run+'-'+label
 url='https://'+HOST+TARGET+'?'+query
 headers=OUT/(label+'.headers');body=OUT/(label+'.body')
 cmd=['curl','--silent','--show-error','--http1.1','--proto','=https','--connect-timeout','8',
  '--max-time','15','--retry','0','--max-filesize','1024','--range','0-1023',
  '--noproxy',HOST,'--resolve',HOST+':443:'+ip,'--header','Accept-Encoding: identity',
  '--user-agent','OMC-Bounded-Cloud-Diagnostic/09','--dump-header',str(headers),'--output',str(body),
  '--write-out','{"httpCode":"%{http_code}","remoteIp":"%{remote_ip}","sslVerifyResult":"%{ssl_verify_result}","bytes":"%{size_download}","seconds":"%{time_total}"}']
 if tls:cmd+=['--tlsv'+tls,'--tls-max',tls]
 cmd+=[url]
 row={'label':label,'requestedIp':ip,'queryMarker':query,'tlsConstraint':tls or 'default validated TLS',
  'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  r=subprocess.run(cmd,capture_output=True,text=True,timeout=20)
  row['curlExitCode']=r.returncode;row['error']=r.stderr[-1200:]
  try:row['transfer']=json.loads(r.stdout)
  except ValueError:row['transfer']={'parseError':True}
  safe={}
  if headers.exists():
   for line in headers.read_text(errors='replace')[:32768].splitlines():
    if ':' in line:
     key,value=line.split(':',1)
     if key.lower() in SAFE_HEADERS:safe[key.lower()]=value.strip()[:1000]
  row['headers']=safe
  b=body.read_bytes() if body.exists() else b''
  assert len(b)<=1024,'BODY_LIMIT'
  row['bodyBytes']=len(b);row['bodySha256']=hashlib.sha256(b).hexdigest() if b else None
  row['validRange']=r.returncode==0 and row['transfer'].get('httpCode')=='206' and row['transfer'].get('sslVerifyResult')=='0' and row['transfer'].get('remoteIp')==ip and len(b)==1024 and safe.get('content-range')=='bytes 0-1023/848245530'
 except Exception as e:row['error']=str(e)[:1200];row['validRange']=False
 report['rows'].append(row)
 (OUT/'RESULT.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'label':label,'validRange':row['validRange'],'curlExitCode':row.get('curlExitCode'),'httpCode':row.get('transfer',{}).get('httpCode')}),flush=True)
report['allRoutesPassed']=all(r['validRange'] for r in report['rows'])
report['sameBodyAcrossPassingRoutes']=len({r['bodySha256'] for r in report['rows'] if r['validRange']})<=1
report['conclusionBoundary']='Failures and absent access logs alone do not identify a device or prove RST origin. No complete installer SHA or member-speed acceptance.'
(OUT/'RESULT.json').write_text(json.dumps(report,indent=2)+'\n')
raise SystemExit(0 if report['allRoutesPassed'] and report['sameBodyAcrossPassingRoutes'] else 1)

// Cloud-only component endurance: current client, immutable Preview19 engine.
// This deliberately does not claim a new installed product or photo accuracy.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const [source,installer,work]=process.argv.slice(2);
const req=createRequire(path.join(source,'package.json'));
const assert=(value,message)=>{if(!value)throw Error(message);};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function hashFile(file){const h=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))h.update(bytes);return h.digest('hex');}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
assert(process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true'
 &&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks'
 &&process.env.GITHUB_REF==='refs/heads/verify-optimization20','APPROVED_WINDOWS_CLOUD_ONLY');
fs.mkdirSync(work);const evidence=path.join(work,'evidence');fs.mkdirSync(evidence);
const report={status:'RUNNING',schema:'omc-immutable-engine-endurance-baseline-v1',
 engineInstallerVersion:'1.0.21-preview.19',engineInstallerSha256:'daade4392f5b77262fbd1f53b4ffbcb89e73290952f1a0779739c0ff8d97eb27',
 currentInstalledProductQualified:false,modelAccuracyCertified:false,realPhotoThroughputQualified:false,
 gpuThroughputQualified:false,memberDataUsed:false,modelsChanged:false,
 inputs:0,inputBytes:0,completed:0,cohorts:[],samples:[],httpBatches:[],limitations:[
 'Current JS API client and frozen Preview19 engine, not rebuilt current Python entry or installed app',
 '1000 unique synthetic 320x240 inputs, not 1000 independent real camera photos',
 'Controlled CPU fallback via unavailable DirectML adapter -1; no physical GPU claim',
 'CPU percentage is the existing endpoint capped at 100, not whole-host saturation',
 'Memory is sampled between completions, not a continuous allocation peak',
 'No renderer import, MediaPipe, editing, selection accuracy, installation or upgrade qualification']};
const save=()=>fs.writeFileSync(path.join(evidence,'ENGINE_BASELINE.json'),JSON.stringify(report,null,2));
let proc,processError,log,token,prepareToken,api,originalFetch=globalThis.fetch;
const deadline=Date.now()+30*60*1000;
const ownedEnv={...process.env};
for(const key of Object.keys(ownedEnv))if(/^(OMC_|PYTHON|VIRTUAL_ENV|CONDA_PREFIX|GH_TOKEN$|GITHUB_TOKEN$|NODE_OPTIONS$|NODE_PATH$)/i.test(key))delete ownedEnv[key];
try{
 assert(req('app-builder-lib/package.json').version==='26.15.3','APPROVED_BUILDER_VERSION');
 const verification=req('./electron/installerVerification.cjs');
 assert(fs.statSync(installer).size===803348413&&await hashFile(installer)===report.engineInstallerSha256,'IMMUTABLE_ENGINE_INSTALLER_BYTES');
 verification.assertNsisInstallerExecutable(installer);
 const {getPath7za}=req('app-builder-lib/out/toolsets/7zip');
 const seven=(await getPath7za());const tool=verification.assertApprovedSevenZip(seven);
 report.extractor={sha256:tool.sha256,bytes:tool.size};
 const unpacked=path.join(work,'one-app');fs.mkdirSync(unpacked);
 execFileSync(seven,['t','-t7z','-bd','-bb0',installer],{env:ownedEnv,windowsHide:true,timeout:180000,stdio:'pipe'});
 execFileSync(seven,['x','-t7z','-y','-bd','-bb0','-o'+unpacked,installer],{env:ownedEnv,windowsHide:true,timeout:180000,stdio:'pipe'});
 const serviceRoot=path.join(unpacked,'resources/ai-service'),executable=path.join(serviceRoot,'ai-service.exe');
 assert(fs.statSync(executable).isFile()&&fs.statSync(path.join(unpacked,'resources/app.asar')).isFile(),'DIRECT_VERIFIED_APP_PAYLOAD_REQUIRED');
 report.engineExecutableSha256=await hashFile(executable);
 report.frozenEngineFiles=[];
 async function recordEngineFiles(directory){
  for(const item of fs.readdirSync(directory,{withFileTypes:true})){
   const file=path.join(directory,item.name);
   if(item.isDirectory())await recordEngineFiles(file);
   else if(item.isFile()&&(/\.(onnx|data|npy)$/i.test(item.name)||item.name==='python314.dll')){
    report.frozenEngineFiles.push({path:path.relative(serviceRoot,file).replaceAll('\\','/'),bytes:fs.statSync(file).size,sha256:await hashFile(file)});
   }
  }
 }
 await recordEngineFiles(serviceRoot);save();
 const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 token=crypto.randomBytes(32).toString('hex');prepareToken=crypto.randomBytes(32).toString('hex');
 const env={...ownedEnv,PATH:path.join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot,
  OMC_AI_TOKEN:token,OMC_AI_PREPARE_TOKEN:prepareToken,OMC_AI_PORT:String(port),
  OMC_AI_DATA_DIR:path.join(work,'isolated-dataset'),OMC_AI_DML_DEVICE_ID:'-1',OMC_RETAIN_NATIVE_ORT_PROFILES_FOR_EVIDENCE:'0'};
 log=fs.openSync(path.join(evidence,'engine-output.log'),'wx');
 proc=spawn(executable,[],{cwd:serviceRoot,env,windowsHide:true,stdio:['ignore',log,log]});
 proc.once('error',error=>{processError=String(error);});
 report.launcherPid=proc.pid;api='http://127.0.0.1:'+port;
 const headers={Authorization:'Bearer '+token};
 async function json(route,options={}){
  const response=await originalFetch(api+route,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(10000)});
  assert(response.ok,'ENGINE_HTTP_'+route+'_'+response.status);return response.json();
 }
 let healthy=false;
 for(let attempt=0;attempt<180;attempt++){
  assert(!processError&&proc.exitCode===null&&proc.signalCode===null,'ENGINE_EXITED_BEFORE_HEALTH_'+(processError||''));
  try{healthy=(await json('/health')).status==='ok';if(healthy)break;}catch{}
  await sleep(500);
 }
 assert(healthy,'ENGINE_HEALTH_TIMEOUT');
 const accepted=await json('/runtime/prepare',{method:'POST',headers:{'Content-Type':'application/json','X-OMC-Prepare-Capability':prepareToken},
  body:JSON.stringify({trigger:'T_ai',requested_at_epoch_ms:Date.now(),host_runtime:{platform:'win32',arch:'x64',os_release:'Windows',os_version:os.release(),native_dxgi_adapters:[]}})});
 assert(accepted.accepted===true,'NORMAL_RUNTIME_PREPARATION_REJECTED');
 let info;
 for(let attempt=0;attempt<180;attempt++){
  assert(proc.exitCode===null&&proc.signalCode===null,'ENGINE_EXITED_DURING_PREPARE');info=await json('/info');
  if(info.service?.full_ai_ready===true)break;
  assert(!['error','circuit-open','degraded'].includes(info.service?.state),'ENGINE_PREPARE_'+info.service?.state);
  await sleep(2000);
 }
 assert(info?.service?.full_ai_ready&&info.clip_available&&info.technical_model?.loaded
  &&info.content_model?.loaded&&info.quality_reference?.loaded,'FULL_CORE_COMPONENTS_NOT_READY');
 assert(info.provider==='CPUExecutionProvider','EXPECTED_CONTROLLED_CPU_SCENARIO');
 report.provider=info.provider;report.host={logicalProcessors:os.availableParallelism(),totalMemoryBytes:os.totalmem()};
 report.initialModelStatus={technical:info.technical_model,qualityReference:info.quality_reference,content:info.content_model};
 // This adapter supplies the actual owned endpoint/capability, not readiness,
 // inference data, receipts, semantic contributions or successful responses.
 globalThis.window={electronAPI:{getAiServiceStatus:async()=>({port,token})}};
 const client=await import(pathToFileURL(path.join(source,'src/services/ai/modelLoader.js')).href);
 report.clientSha256=hash(fs.readFileSync(path.join(source,'src/services/ai/modelLoader.js')));
 report.microBatcherSha256=hash(fs.readFileSync(path.join(source,'src/services/microBatcher.js')));
 await client.checkApiServer();assert(client.isApiServerAvailable(),'CURRENT_CLIENT_DID_NOT_ACCEPT_ACTUAL_HEALTH');
 globalThis.fetch=async(input,options)=>{
  const route=new URL(typeof input==='string'?input:input.url).pathname;
  if(route==='/analyze/batch'||route==='/analyze/photo')report.httpBatches.push({route,size:options?.body?.getAll?.('images')?.length||1});
  return originalFetch(input,options);
 };
 const jpeg=req('jpeg-js'),inputHashes=new Set(),outputHashes=new Set();
 const {runAnalysisWorkerPool}=await import(pathToFileURL(path.join(source,'src/services/analysisPerformance.js')).href);
 const context={projectId:'synthetic-engine-'+crypto.randomUUID(),analysisRunId:crypto.randomUUID(),analysisGeneration:1};
 const namespace='cold-engine-'+crypto.randomUUID();
 async function sample(){
  const metrics=await json('/runtime/native-metrics');
  assert(Number.isInteger(metrics.pid)&&metrics.pid>0&&Number.isFinite(metrics.private_memory_bytes),'NATIVE_METRICS_UNAVAILABLE');
  const disk=fs.statfsSync(work),free=Number(disk.bavail)*Number(disk.bsize);
  assert(free>2*1024**3,'STOP_VM_DISK_FLOOR');
  assert(metrics.private_memory_bytes<4*1024**3,'STOP_ENGINE_PRIVATE_MEMORY_4_GIB');
  report.samples.push({completed:report.completed,elapsedMs:Date.now()-report.startedAtEpochMs,metrics,nodeMemory:process.memoryUsage(),freeBytes:free});save();
 }
 report.startedAtEpochMs=Date.now();await sample();
 for(const cohort of [{start:0,count:250,concurrency:2},{start:250,count:750,concurrency:6}]){
  const start=Date.now(),latencies=[];
  await runAnalysisWorkerPool(Array.from({length:cohort.count},(_,j)=>cohort.start+j),async index=>{
   assert(Date.now()<deadline,'STOP_ENGINE_BASELINE_30_MINUTES');
   const width=320,height=240,rgba=Buffer.alloc(width*height*4);
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const k=(y*width+x)*4;rgba[k]=(x+(index%251)*17+(y>>2))%256;
    rgba[k+1]=(y+Math.floor(index/251)*29+(x>>3))%256;
    rgba[k+2]=((x^y)*((index%13)+1)+Math.floor(index/16))%256;rgba[k+3]=255;
   }
   const bytes=jpeg.encode({data:rgba,width,height},85).data,sha=hash(bytes);
   assert(!inputHashes.has(sha),'SYNTHETIC_INPUT_NOT_DISTINCT');inputHashes.add(sha);report.inputs++;report.inputBytes+=bytes.length;
   const requestStarted=performance.now();
   const value=await client.analyzePhotoApi(new Blob([bytes],{type:'image/jpeg'}),'sports',{
    cacheNamespace:namespace,analysisContext:context,inferenceIdentity:{photoId:'photo-'+index,assetId:sha},requestTimeoutMs:180000});
   const defectMap=value?.technical?.defectProbabilities??{};
   const defects=Object.values(defectMap);
   assert(Object.keys(defectMap).sort().join('|')===['blur','overexposure','underexposure','noise','jpeg_artifact','color_distortion','low_resolution'].sort().join('|'),'SEVEN_EXPECTED_DEFECT_NAMES');
   assert(value?.available===true&&value.technical?.available===true&&value.technical.qualityReference?.available===true
    &&value.themes?.available===true,'COMPLETE_AI_COMPONENTS_UNAVAILABLE');
   assert(defects.length===7&&defects.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1),'SEVEN_FINITE_DEFECT_OUTPUTS');
   assert(value.feature_hash===sha&&value.analysis_input_identity?.input_sha256===sha
    &&value.analysis_input_identity.photo_id==='photo-'+index,'INPUT_RESULT_IDENTITY_CHANGED');
   const identity=value.analysis_input_identity;
   assert(identity.schema_version==='omc-analysis-input-identity-v1'&&identity.project_id===context.projectId
    &&identity.analysis_run_id===context.analysisRunId&&identity.analysis_generation===context.analysisGeneration
    &&identity.asset_id===sha&&identity.cache_namespace===namespace,'RESULT_CONTEXT_CHANGED');
   assert(!outputHashes.has(sha),'DUPLICATE_SUCCESSFUL_RESULT');outputHashes.add(sha);report.completed++;
   latencies.push(performance.now()-requestStarted);
   if(report.completed%50===0){await sample();console.log(JSON.stringify({completed:report.completed,elapsedMs:Date.now()-report.startedAtEpochMs}));}
  },{concurrency:cohort.concurrency});
  latencies.sort((a,b)=>a-b);
  report.cohorts.push({...cohort,completed:latencies.length,elapsedMs:Date.now()-start,
   requestLatencyMs:{p50:latencies[Math.ceil(latencies.length*.5)-1],p95:latencies[Math.ceil(latencies.length*.95)-1],max:latencies.at(-1)}});save();
 }
 await sample();assert(report.inputs===1000&&report.completed===1000&&outputHashes.size===1000,'ENGINE_INPUT_ACCOUNTING');
 report.totalElapsedMs=Date.now()-report.startedAtEpochMs;
 report.sampledPeakNativePrivateBytes=Math.max(...report.samples.map(row=>row.metrics.private_memory_bytes));
 report.status='PASS_1000_SYNTHETIC_IMMUTABLE_ENGINE_BASELINE_NOT_CURRENT_PRODUCT';
}catch(error){report.status='FAIL_ENGINE_BASELINE';report.error=String(error.stack||error);
 if(log!==undefined){try{const file=path.join(evidence,'engine-output.log');const bytes=fs.readFileSync(file);report.engineLogTail=bytes.subarray(Math.max(0,bytes.length-12000)).toString('utf8');}catch{}}
 process.exitCode=1;
}finally{
 globalThis.fetch=originalFetch;
 if(proc?.pid){
  if(proc.exitCode===null&&proc.signalCode===null)await new Promise(resolve=>{const kill=spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.on('error',resolve);kill.on('exit',resolve);});
  for(let i=0;i<100&&proc.exitCode===null&&proc.signalCode===null;i++)await sleep(50);
  report.ownedProcessStopped=proc.exitCode!==null||proc.signalCode!==null;
  if(!report.ownedProcessStopped){report.status='FAIL_ENGINE_PROBE_CLEANUP';process.exitCode=1;}
 }
 if(log!==undefined)fs.closeSync(log);token=null;prepareToken=null;save();
}

// Cloud-only normal-project endurance. Only native chooser answers are adapted.
// No direct analysis POSTs, fabricated DB rows, product changes or model replacement.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import os from 'node:os';
const [source,work,sampleA,sampleB,installed]=process.argv.slice(2);
const require=createRequire(path.join(source,'package.json')),jpeg=require('jpeg-js');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const hash=b=>createHash('sha256').update(b).digest('hex');
const check=(v,m)=>{if(!v)throw Error(m);};
const out=path.join(work,'evidence'),fixtureRoot=path.join(work,'fixtures'),profile=path.join(work,'profile');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(fixtureRoot);
const report={schema:'omc-installed-project-endurance-v1',status:'RUNNING',stage:'fixtures',
 sourceTree:'883787ae0ea60c56d348ff758fa150fb3f40007d',fixtureCount:1000,
 limits:['Two authorized original JPEGs; 998 synthetic assets, including16 large raster aliases and3 controlled defocus variants of approved sample-b',
 'Not 1000 independent real camera photos, recognition accuracy, physical GPU throughput or percentile latency',
 'Native chooser answers adapted; actual source grants, import, UI analysis and persistence untouched'],samples:[],rendererErrors:[]};
function save(){fs.writeFileSync(path.join(out,'PROJECT_ENDURANCE.json'),JSON.stringify(report,null,2));}
function stage(value){report.stage=value;save();console.log(JSON.stringify({projectStage:value}));}
const log=fs.openSync(path.join(out,'source-app.log'),'a');
let app,ws,seq=0,service;const pending=new Map(),fixtures=[];
const env={...process.env};
for(const k of Object.keys(env))if(/^(PYTHON|NODE_|OMC_|VITE_|VIRTUAL_ENV|ELECTRON_RUN_AS_NODE|GH_TOKEN|GITHUB_TOKEN|PSModulePath$)/i.test(k))delete env[k];
env.PATH=process.platform==='win32'?path.join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot:'/usr/bin:/bin:/usr/sbin:/sbin';
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT:'+method));},45000);pending.set(id,{resolve,reject,t});ws.send(JSON.stringify({id,method,params}));});}
async function ev(expression){const r=await call('Runtime.evaluate',{expression:'(async()=>JSON.stringify(await ('+expression+')))()',returnByValue:true,awaitPromise:true});check(!r.exceptionDetails,'RENDERER_EVALUATION:'+JSON.stringify(r.exceptionDetails??{}).slice(0,1000));return JSON.parse(r.result.value);}
async function until(expression,ms=120000){const end=Date.now()+ms;while(Date.now()<end){if(await ev('Boolean(await ('+expression+'))'))return;await delay(250);}throw Error('WAIT:'+expression.slice(0,160));}
async function click(label){const expression=`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.offsetWidth&&!e.disabled&&(e.getAttribute('aria-label')===${JSON.stringify(label)}||e.innerText.trim()===${JSON.stringify(label)}));if(!b)return false;b.click();return true;})()`;await until(expression,45000);}
async function snap(name){const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}
async function start(){
 app=spawn(installed,['--inspect=127.0.0.1:0','--user-data-dir='+profile,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run'],{cwd:source,env,stdio:['ignore',log,log],detached:process.platform==='darwin'});
 let target;
 for(let i=0;i<240;i++){try{const port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='page'&&x.url.startsWith('file:')&&x.url.includes('/dist/index.html'));if(target)break;}catch{}if(app.exitCode!==null)throw Error('APP_EARLY_EXIT');await delay(250);}
 check(target,'INSTALLED_MAIN_NOT_FOUND');ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((r,j)=>{const t=setTimeout(()=>j(Error('CDP_CONNECT')),10000);ws.addEventListener('open',()=>{clearTimeout(t);r();},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);j(Error('CDP_CONNECT'));},{once:true});});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown'&&report.rendererErrors.length<30)report.rendererErrors.push(m.params.exceptionDetails);const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await until('document.querySelector("#root")?.innerText.length>40');
}
async function closeNormally(){
 const previous=app;await Promise.race([call('Browser.close').catch(()=>null),delay(5000)]);
 const end=Date.now()+20000;while(previous.exitCode===null&&previous.signalCode===null&&Date.now()<end)await delay(100);
 check(previous.exitCode===0&&previous.signalCode===null,'NORMAL_EXIT_NOT_SETTLED');
 for(const p of pending.values()){clearTimeout(p.t);p.reject(Error('OLD_PAGE_CLOSED'));}pending.clear();try{ws.close();}catch{}
 return{pid:previous.pid,exitCode:previous.exitCode,signal:previous.signalCode};
}
// Same native picker pattern as the existing two-photo flow, with an exact
// disposable-VM fixture list. No product IPC, renderer import or file data mocked.
async function setPicker(){
 const endpoint=[...fs.readFileSync(path.join(out,'source-app.log'),'utf8').matchAll(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/g)].at(-1)?.[1];check(endpoint,'MAIN_INSPECTOR');
 const socket=new WebSocket(endpoint);let timer;
 function adapter(files,root,approved){
  const path=process.mainModule.require('node:path'),fs=process.mainModule.require('node:fs');
  if(files.length!==1000||new Set(files).size!==1000||files.some(p=>!fs.statSync(p).isFile()||(!p.startsWith(root+path.sep)&&!approved.includes(p))))throw Error('EXACT_OWNED_FIXTURE_SCOPE');
  process.mainModule.require('electron').dialog.showOpenDialog=async(...args)=>{const o=args.at(-1);if(o?.title!=='选择照片文件'||!o.properties?.includes('openFile')||!o.properties.includes('multiSelections')||o.properties.includes('openDirectory'))throw Error('UNREVIEWED_CHOOSER');return{canceled:false,filePaths:files};};return true;
 }
 try{
  await new Promise((r,j)=>{timer=setTimeout(()=>j(Error('MAIN_CONNECT')),10000);socket.addEventListener('open',()=>{clearTimeout(timer);r();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);j(Error('MAIN_CONNECT'));},{once:true});});
  return await new Promise((r,j)=>{timer=setTimeout(()=>j(Error('MAIN_PICKER_TIMEOUT')),10000);socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id!==1)return;clearTimeout(timer);m.error||m.result?.exceptionDetails?j(Error('MAIN_PICKER_REJECTED')):r(m.result.result.value);});socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'('+adapter.toString()+')('+JSON.stringify(fixtures.map(f=>f.path))+','+JSON.stringify(fixtureRoot)+','+JSON.stringify([sampleA,sampleB])+')',returnByValue:true,awaitPromise:true}}));});
 }finally{clearTimeout(timer);socket.close();}
}
// Readonly observer: does not create stores, alter source grants, insert assets,
// replace analysis responses or hold a transaction across application work.
function dbObservation(assets=false){return `(${(async function(assets){
 return new Promise((resolve,reject)=>{const q=indexedDB.open('omc-photo-select');
 q.onupgradeneeded=()=>{q.transaction.abort();reject(Error('PROJECT_DB_NOT_CREATED'));};q.onerror=()=>reject(q.error);
 q.onsuccess=()=>{const db=q.result,t=db.transaction(['projects','photoAssets','decisions'],'readonly');
 const pr=t.objectStore('projects').getAll(),ct=t.objectStore('photoAssets').count(),dr=t.objectStore('decisions').getAll();let projects,count,decisions;const rows=[];
 pr.onsuccess=()=>projects=pr.result.map(p=>({id:p.id,count:p.count,importState:p.importState,analysisRunState:p.analysisRunState,analysisFailureCount:p.analysisFailureCount,activeAnalysisRunId:p.activeAnalysisRunId,analysisGeneration:p.analysisGeneration,analysisRunFinishedAt:p.analysisRunFinishedAt,importFailures:p.importFailures?.length??0,automaticReviewLastRun:p.automaticReviewLastRun,batchCount:p.automaticReviewBatches?.length??0}));
 ct.onsuccess=()=>count=ct.result;dr.onsuccess=()=>decisions=dr.result.map(d=>({photoId:d.photoId,decision:d.decision}));
 if(assets){const c=t.objectStore('photoAssets').openCursor();c.onsuccess=()=>{const cur=c.result;if(!cur)return;const a=cur.value;rows.push({id:a.id,projectId:a.projectId,fileName:a.fileName,sourceFullSha256:a.sourceFullSha256,analysisLevel:a.analysis?.analysisLevel,hasThumbnail:!!(a.thumbnailBlob||a.thumbnailUrl),width:a.width,height:a.height,technical:a.analysis?.technical,automaticReview:a.automaticReview??null});cur.continue();};}
 t.oncomplete=()=>{db.close();resolve({projects,count,decisions,...(assets?{assets:rows}:{})});};t.onabort=t.onerror=()=>{db.close();reject(t.error??Error('READONLY_DB_OBSERVATION'));};};});
 }).toString()})(${assets})`;}
async function metric(){try{const r=await fetch('http://127.0.0.1:'+service.port+'/runtime/native-metrics',{headers:{Authorization:'Bearer '+service.token},signal:AbortSignal.timeout(3000)});if(r.ok){const v=await r.json();return{privateMemoryBytes:v.private_memory_bytes,cpuPercent:v.cpu_utilization_percent};}}catch{}return null;}
function verifyRows(data){
 const expected=new Map(fixtures.map(f=>[path.basename(f.path),f.sha256]));
 check(data.projects.length===1&&data.count===1000&&data.assets?.length===1000,'PROJECT_ASSET_COUNT');
 const project=data.projects[0];check(project.importState==='complete'&&project.analysisRunState==='completed'&&!project.activeAnalysisRunId&&project.analysisFailureCount===0&&project.importFailures===0,'PROJECT_TERMINAL_STATE');
 check(new Set(data.assets.map(a=>a.id)).size===1000,'ASSET_ID_UNIQUENESS');
 for(const a of data.assets){check(a.projectId===project.id&&expected.has(a.fileName)&&a.sourceFullSha256===expected.get(a.fileName),'ACTUAL_SOURCE_BYTE_BINDING');check(a.analysisLevel==='full_ai'&&a.hasThumbnail&&a.width>0&&a.height>0,'COMPLETE_AI_AND_PREVIEW_FOR_EVERY_ASSET');expected.delete(a.fileName);}
 check(expected.size===0,'FIXTURE_COVERAGE');return project;
}
function makeControlledDefocus(input){
 const decoded=jpeg.decode(input,{useTArray:true,maxMemoryUsageInMB:1024});
 const {width,height}=decoded;let pixels=decoded.data;const temporary=new Uint8ClampedArray(pixels.length),soft=new Uint8ClampedArray(pixels.length),radius=6,span=13;
 // Three separable box passes, sigma=sqrt(r*(r+1)) native pixels. A known
 // synthetic degradation; never labelled as a new human-reviewed original.
 for(let pass=0;pass<3;pass++){
  for(let y=0;y<height;y++)for(let c=0;c<3;c++){let sum=0;for(let d=-radius;d<=radius;d++)sum+=pixels[(y*width+Math.max(0,Math.min(width-1,d)))*4+c];for(let x=0;x<width;x++){const p=(y*width+x)*4;temporary[p+c]=Math.round(sum/span);temporary[p+3]=255;sum+=pixels[(y*width+Math.min(width-1,x+radius+1))*4+c]-pixels[(y*width+Math.max(0,x-radius))*4+c];}}
  for(let x=0;x<width;x++)for(let c=0;c<3;c++){let sum=0;for(let d=-radius;d<=radius;d++)sum+=temporary[(Math.max(0,Math.min(height-1,d))*width+x)*4+c];for(let y=0;y<height;y++){const p=(y*width+x)*4;soft[p+c]=Math.round(sum/span);soft[p+3]=255;sum+=temporary[(Math.min(height-1,y+radius+1)*width+x)*4+c]-temporary[(Math.max(0,y-radius)*width+x)*4+c];}}pixels=soft;
 }
 return jpeg.encode({data:soft,width,height},95).data;
}
try{
 check(['win32','darwin'].includes(process.platform)&&process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks'&&process.env.GITHUB_REF==='refs/heads/verify-optimization20'&&process.env.GITHUB_RUN_ATTEMPT==='1','CLOUD_SCOPE');
 const owned=path.resolve(process.env.RUNNER_TEMP)+path.sep;check(path.resolve(work).startsWith(owned)&&path.isAbsolute(installed)&&fs.statSync(installed).isFile(),'OWNED_WORK_AND_REAL_INSTALLED_EXE');
 report.cloudMachine={logicalProcessors:os.availableParallelism(),totalMemoryBytes:os.totalmem(),physicalMemberHardwareQualified:false};
 function treeBytes(root){let total=0;for(const row of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,row.name);if(row.isSymbolicLink())continue;total+=row.isDirectory()?treeBytes(file):fs.statSync(file).size;}return total;}
 const before=treeBytes(path.dirname(work)),installedBytes=treeBytes(process.platform==='darwin'?installed.split('/Contents/MacOS/')[0]:path.dirname(installed)),fixtureBudget=256*1024**2,cacheReserve=512*1024**2;
 report.storageBudget={workBytesBeforeFixtures:before,installedBytes,fixtureBudget,cacheReserve,maximumWorkingBytes:5*1024**3};
 check(before+installedBytes+fixtureBudget+cacheReserve<=5*1024**3,'FIVE_GIB_WORKING_BUDGET');
 for(const p of [sampleA,sampleB]){check(path.resolve(p).startsWith(owned),'APPROVED_INPUT_PATH');const b=fs.readFileSync(p);fixtures.push({path:p,sha256:hash(b),bytes:b.length,kind:'authorized-original'});}
 const started=Date.now(),width=4096,height=2732,rgba=Buffer.alloc(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;rgba[i]=40+(x%170);rgba[i+1]=30+(y%175);rgba[i+2]=((x>>5)^(y>>5))&1?170:50;rgba[i+3]=255;}
 const large=jpeg.encode({data:rgba,width,height},82).data;
 function add(name,bytes,kind){check(fixtures.reduce((n,f)=>n+f.bytes,0)+bytes.length<=256*1024**2,'FIXTURE_BYTE_BUDGET');const p=path.join(fixtureRoot,name);fs.writeFileSync(p,bytes,{flag:'wx'});fixtures.push({path:p,bytes:bytes.length,sha256:hash(bytes),kind});}
 for(let i=0;i<16;i++){const tag=Buffer.from('omc-generated-owned-alias-'+i),header=Buffer.alloc(4);header[0]=255;header[1]=239;header.writeUInt16BE(tag.length+2,2);add('large-'+String(i).padStart(4,'0')+'.jpg',Buffer.concat([large.subarray(0,2),header,tag,large.subarray(2)]),'synthetic-large-raster-alias');}
 const degraded=makeControlledDefocus(fs.readFileSync(sampleB));
 for(let i=0;i<3;i++){const tag=Buffer.from('controlled-owned-defocus-'+i),header=Buffer.alloc(4);header[0]=255;header[1]=239;header.writeUInt16BE(tag.length+2,2);add('controlled-defocus-'+i+'.jpg',Buffer.concat([degraded.subarray(0,2),header,tag,degraded.subarray(2)]),'synthetic-defocus-derived-from-approved-sample-b');}
 const small=Buffer.alloc(640*426*4);
 for(let n=0;n<979;n++){for(let y=0;y<426;y++)for(let x=0;x<640;x++){const i=(y*640+x)*4;small[i]=(x*3+n*7+y)%256;small[i+1]=(y*3+n*13+(x>>3))%256;small[i+2]=(((x+n*11)>>4)^((y+n*3)>>4))*29%256;small[i+3]=255;}add('generated-'+String(n).padStart(4,'0')+'.jpg',jpeg.encode({data:small,width:640,height:426},60).data,'synthetic-unique-raster');}
 check(fixtures.length===1000&&new Set(fixtures.map(f=>f.sha256)).size===1000,'FIXTURE_COUNT_AND_BYTE_UNIQUENESS');report.fixtures={bytes:fixtures.reduce((n,f)=>n+f.bytes,0),generationMs:Date.now()-started,realOriginalCount:2,syntheticLargeAliases:16,syntheticUniqueSmall:979,syntheticDefocusControls:3};save();
 stage('launch');await start();await click('使用此编号开始选片');if(await ev('Boolean(document.querySelector("button[aria-label=跳过新手引导]"))'))await click('跳过新手引导');
 stage('bundled-ai-warmup');const warm=Date.now(),prep=await ev('window.electronAPI.beginAiAnalysis()');check(prep?.runtimePreparation?.accepted===true,'BUNDLED_PREPARATION');await until('window.electronAPI.getAiServiceStatus().then(s=>s.lastHealth?.fullAiReady===true)',240000);report.aiWarmupMs=Date.now()-warm;service=await ev('window.electronAPI.getAiServiceStatus().then(s=>({port:s.port,token:s.token}))');check(Number.isInteger(service.port)&&service.token,'BUNDLED_ENDPOINT');
 stage('normal-ui-import-and-auto-analysis');await click('导入照片');check(await setPicker(),'OWNED_NATIVE_PICKER');const importStart=Date.now();await click('选择文件');
 // Observe cheap metadata every 3s; read full asset summaries only at terminal
 // state, never in a tight progress loop. Actual UI automatically starts AI.
 let final,importMs=null;const deadline=Date.now()+35*60*1000;
 while(Date.now()<deadline){
  check(app.exitCode===null,'APP_EXIT_DURING_PROJECT');await delay(3000);
  const d=await ev(dbObservation(false)),p=d.projects[0],elapsedMs=Date.now()-importStart;
  const ui=await ev('(()=>({workflow:[...document.querySelectorAll(".workflow-step")].map(e=>e.getAttribute("aria-label")),tiles:document.querySelectorAll(".photo-tile").length,rendererHeapBytes:performance.memory?.usedJSHeapSize??null,alerts:[...document.querySelectorAll("[role=alert]")].map(e=>e.innerText.slice(0,500))}))()');
  report.samples.push({elapsedMs,count:d.count,project:p??null,workflow:ui.workflow,renderedTiles:ui.tiles,rendererHeapBytes:ui.rendererHeapBytes,alerts:ui.alerts,metrics:await metric()});
  if(p?.importState==='complete'&&d.count===1000&&importMs===null){importMs=elapsedMs;report.importObservedMs=importMs;await snap('import-complete');}
  if(p?.importState==='complete'&&d.count===1000&&p.analysisRunState==='completed'&&p.automaticReviewLastRun?.generation===p.analysisGeneration){
   const observed=await ev(dbObservation(true));if(observed.assets.filter(a=>a.analysisLevel==='full_ai').length===1000){verifyRows(observed);final=observed;break;}
  }
  save();if(report.samples.length%10===0)console.log(JSON.stringify({elapsedMs,count:d.count,state:p?.analysisRunState??null,workflow:ui.workflow[1]??null}));
 }
 check(final,'THOUSAND_NORMAL_UI_ANALYSIS_NOT_COMPLETED');report.analysisObservedMs=Date.now()-importStart;report.project=verifyRows(final);report.finalAssetLevels={fullAi:1000,failed:0};report.automaticReview={completed:true,run:final.projects[0].automaticReviewLastRun,classifiedCount:final.assets.filter(a=>a.automaticReview).length,classificationDigest:hash(Buffer.from(JSON.stringify(final.assets.map(a=>[a.id,a.automaticReview]).sort())))};check(report.rendererErrors.length===0,'RENDERER_ERRORS_DURING_THOUSAND');const clear=final.assets.filter(a=>[path.basename(sampleA),path.basename(sampleB)].includes(a.fileName)),bad=final.assets.filter(a=>a.fileName.startsWith('controlled-defocus-'));check(clear.length===2&&clear.every(a=>!a.automaticReview),'CLEAR_ORIGINAL_REJECTED_IN_SCALE');check(bad.length===3&&bad.every(a=>a.automaticReview?.kind==='severe-subject-softness-original'),'SUBJECT_BRANCH_NOT_EXERCISED_IN_SCALE');check(final.projects[0].automaticReviewLastRun.candidateCount>=3&&final.projects[0].automaticReviewLastRun.inspectedCount>=3,'NATIVE_SUBJECT_NOMINEES_NOT_VERIFIED');report.automaticReview.severeSubjectControlsPassed=3;report.automaticReview.clearOriginalsPreserved=2;await until('[...document.querySelectorAll(".workflow-step")].some(e=>e.getAttribute("aria-label")?.includes("AI 增强分析 1000/1000"))',30000);report.uiCompleted=await ev('[...document.querySelectorAll(".workflow-step")].map(e=>e.getAttribute("aria-label"))');await snap('analysis-complete');
 stage('normal-exit-and-restart');report.beforeRestart=await closeNormally();await start();await until('document.querySelectorAll(".photo-tile").length>0&&[...document.querySelectorAll(".workflow-step")].some(e=>e.getAttribute("aria-label")?.includes("AI 增强分析 1000/1000"))',120000);const restored=await ev(dbObservation(true));verifyRows(restored);check(JSON.stringify(restored.assets.map(a=>[a.id,a.sourceFullSha256,a.analysisLevel]).sort())===JSON.stringify(final.assets.map(a=>[a.id,a.sourceFullSha256,a.analysisLevel]).sort()),'PERSISTED_RESULTS_CHANGED');check(hash(Buffer.from(JSON.stringify(restored.assets.map(a=>[a.id,a.automaticReview]).sort())))===report.automaticReview.classificationDigest,'SCALE_CLASSIFICATION_NOT_PERSISTED');report.restored={sameProfile:true,actualRestart:true,fullAi:1000,projectId:restored.projects[0].id};await snap('restored');
 stage('original-protection');check(fixtures.every(f=>hash(fs.readFileSync(f.path))===f.sha256),'SOURCE_MODIFIED');report.originalsUnchanged=true;report.finalExit=await closeNormally();report.status='PASS_INSTALLED_NORMAL_PROJECT_1000_IMPORT_AI_RESTART';stage('done');
}catch(e){report.status='FAIL';report.error=String(e.stack??e);try{report.dom=await ev('document.body.innerText.slice(0,18000)');await snap('failure');}catch{}save();}
finally{
 if(app?.pid&&app.exitCode===null&&app.signalCode===null&&process.platform==='darwin'){try{process.kill(-app.pid,'SIGTERM');}catch{}}
 if(app?.pid&&app.exitCode===null&&app.signalCode===null&&process.platform==='win32')await new Promise(resolve=>{const p=spawn('taskkill',['/PID',String(app.pid),'/T','/F'],{stdio:'ignore'});p.on('exit',resolve);p.on('error',resolve);});
 for(const p of pending.values()){clearTimeout(p.t);p.reject(Error('ENDURANCE_FINISHED'));}pending.clear();try{ws?.close();}catch{}service=null;save();fs.closeSync(log);
}
if(report.status!=='PASS_INSTALLED_NORMAL_PROJECT_1000_IMPORT_AI_RESTART')process.exitCode=1;

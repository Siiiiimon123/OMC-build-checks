// Generic cloud driver. Product source and authorized samples are decrypted only inside the VM.
import fs from 'node:fs';
import {runFinishedFlow,installCloudImportPicker} from './cloud-finished-flow.mjs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const [source,work,providedFixture]=process.argv.slice(2), require=createRequire(path.join(source,'package.json'));
const jpeg=require('jpeg-js'), delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={schema:'omc-cloud-jpeg-functional-v1',status:'RUNNING',stage:'fixture',syntheticOnly:true,memberDataUsed:false,installedPackageTested:false,aiTested:false,osPickerManuallyTested:false,frames:[]};
let app,vite,ws,seq=0,originalPath;const pending=new Map();
const hash=b=>createHash('sha256').update(b).digest('hex');
function assert(v,m){if(!v)throw Error(m);}
const out=path.join(work,'evidence');fs.mkdirSync(out,{recursive:true});
let currentStage=report.stage;
Object.defineProperty(report,'stage',{enumerable:true,get:()=>currentStage,set:value=>{currentStage=value;fs.writeFileSync(path.join(out,'PROGRESS.json'),JSON.stringify({stage:value,at:new Date().toISOString()}));console.log(JSON.stringify({stage:value}));}});
const log=fs.openSync(path.join(out,'source-app.log'),'a');
const env={...process.env};delete env.OMC_PREVIEW15_TRANSPORT_KEY;delete env.GH_TOKEN;delete env.GITHUB_TOKEN;delete env.ELECTRON_RUN_AS_NODE;
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT:'+method));},45000);pending.set(id,{resolve,reject,t});ws.send(JSON.stringify({id,method,params}));});
async function ev(expression){const r=await call('Runtime.evaluate',{expression:'(async()=>{const value=await ('+expression+');return JSON.stringify(value);})()',returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('RENDERER_EVAL:'+JSON.stringify(r.exceptionDetails).slice(0,1200));return JSON.parse(r.result.value);}
async function until(expression,ms=120000){const end=Date.now()+ms;while(Date.now()<end){if(await ev('Boolean(await ('+expression+'))'))return;await delay(200);}throw Error('WAIT:'+expression.slice(0,130));}
async function click(text){await until(`([...document.querySelectorAll('button')].some(e=>e.offsetWidth&&!e.disabled&&(e.getAttribute('aria-label')===${JSON.stringify(text)}||e.innerText.trim()===${JSON.stringify(text)})))`,30000);assert(await ev(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.offsetWidth&&!e.disabled&&(e.getAttribute('aria-label')===${JSON.stringify(text)}||e.innerText.trim()===${JSON.stringify(text)}));if(!e)return false;e.click();return true})()`),'BUTTON:'+text);}
async function snap(name){const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}
try{
 const expectedBranch='refs/heads/verify-optimization20';
 assert(['win32','darwin'].includes(process.platform)&&process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks'&&process.env.GITHUB_REF===expectedBranch,'CLOUD_SCOPE');
 let fixture=providedFixture,width=null,height=null,nearFixture=null;
 if(!fixture){width=2304;height=1536;const rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,c=((x>>5)^(y>>5))&1;rgba[i]=40+(x%160);rgba[i+1]=35+(y%165);rgba[i+2]=c?155:60;rgba[i+3]=255;}
  fixture=path.join(work,'synthetic-large.jpg');fs.writeFileSync(fixture,jpeg.encode({data:rgba,width,height},88).data);
  // Independently generated near-match; no additional member photograph.
  for(let y=96;y<104;y++)for(let x=96;x<104;x++){const i=(y*width+x)*4;rgba[i]=255;rgba[i+1]=0;rgba[i+2]=0;}
  nearFixture=path.join(work,'synthetic-near.jpg');fs.writeFileSync(nearFixture,jpeg.encode({data:rgba,width,height},88).data);
 }else{report.syntheticOnly=false;report.memberDataUsed=true;}
 originalPath=fixture;const encoded=fs.readFileSync(fixture);report.original={width,height,bytes:encoded.length,sha256:hash(encoded)};
 const fixtureRows=[fixture,...(nearFixture?[nearFixture]:[])].map(p=>({path:p,sha256:hash(fs.readFileSync(p))}));
 report.fixtureCount=fixtureRows.length;
 report.stage='launch';
 vite=spawn(process.execPath,[path.join(source,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5173','--strictPort'],{cwd:source,env,stdio:['ignore',log,log],detached:process.platform==='darwin'});
 let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch('http://127.0.0.1:5173')).ok;if(ready)break;}catch{}await delay(200);}assert(ready,'VITE_START');
 let profile=path.join(work,'profile');
 async function startApp(){
 const executable=process.platform==='darwin'?'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron':'node_modules/electron/dist/electron.exe';
 app=spawn(path.join(source,executable),['--inspect=127.0.0.1:0',source,'--user-data-dir='+profile,'--remote-debugging-port=0','--no-first-run'],{cwd:source,env,stdio:['ignore',log,log],detached:process.platform==='darwin'});
 let target;for(let i=0;i<200;i++){try{const port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);const rows=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();target=rows.find(x=>x.type==='page'&&x.url.startsWith('http://localhost:5173'));if(target)break;}catch{}await delay(250);}assert(target,'NORMAL_SOURCE_MAIN_NOT_FOUND');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{const t=setTimeout(()=>j(Error('CDP_CONNECT_TIMEOUT')),10000);ws.addEventListener('open',()=>{clearTimeout(t);r();},{once:true});ws.addEventListener('error',e=>{clearTimeout(t);j(e);},{once:true});});ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:process.env.OMC_R20_VIEWPORT==='compact'?1280:2560,height:process.env.OMC_R20_VIEWPORT==='compact'?800:1440,deviceScaleFactor:1,mobile:false});
 await until('document.querySelector("#root")?.innerText.length>40');
 }
 await startApp();
 report.stage='import';await until('[...document.querySelectorAll("button")].some(e=>e.offsetWidth&&e.innerText.trim()==="使用此编号开始选片")',45000);await click('使用此编号开始选片');
 if(await ev('Boolean(document.querySelector("button[aria-label=跳过新手引导]"))'))await click('跳过新手引导');
 report.stage='generate-bounded-stress-inputs';
 const stressDir=path.join(work,'synthetic-1000');fs.mkdirSync(stressDir);
 const mothers=[];let physicalSourceBytes=0;
 for(let seed=0;seed<16;seed++){
  const w=2304,h=1536,data=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const p=(y*w+x)*4,c=((x>>(4+seed%3))^(y>>(4+seed%3)))&1;
   data[p]=(x+seed*17)%220+15;data[p+1]=(y+seed*29)%220+15;data[p+2]=c?70+seed*7:35;data[p+3]=255;
  }
  const encoded=jpeg.encode({data,width:w,height:h},82).data,parts=[encoded.subarray(0,2)];
  let bytes=encoded.length;
  while(bytes<1024*1024){const app=Buffer.alloc(60004,seed);app[0]=255;app[1]=239;app.writeUInt16BE(60002,2);parts.push(app);bytes+=app.length;}
  parts.push(encoded.subarray(2));
  const mother=path.join(stressDir,`mother-${seed}.jpg`);fs.writeFileSync(mother,Buffer.concat(parts));
  mothers.push(mother);physicalSourceBytes+=bytes;
 }
 assert(physicalSourceBytes<=32*1024*1024,'STRESS_SOURCE_BUDGET');
 const files=[];
 for(let n=0;n<1000;n++){const p=path.join(stressDir,`stress-${String(n).padStart(4,'0')}.jpg`);fs.linkSync(mothers[n%16],p);files.push(p);}

 const recoveryCount=process.env.OMC_R20_RECOVERY_UI_ONLY==='1'?128:1000;
 files.splice(recoveryCount);
 report.stressScope={logicalInputs:recoveryCount,uniquePixelSources:16,syntheticOnly:true,hardlinks:true,
  physicalSourceBytes,osPageCacheBenefits:true,realPhotoThroughputQualified:false,aiThroughputQualified:false};
 const sourceHashes=new Map(mothers.map(file=>[file,hash(fs.readFileSync(file))]));
 async function snapshot(){return ev(`new Promise((resolve,reject)=>{
  const open=indexedDB.open('omc-photo-select');open.onerror=()=>reject(open.error);
  open.onupgradeneeded=()=>{open.transaction.abort();reject(Error('RECOVERY_DB_NOT_READY'));};
  open.onsuccess=()=>{const db=open.result,tx=db.transaction(['projects','photoAssets','decisions'],'readonly'),result={};
   tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};
   const projects=tx.objectStore('projects').getAll();projects.onsuccess=()=>{
    if(projects.result.length!==1){result.projectCount=projects.result.length;return;}
    const p=projects.result[0];result.projectCount=1;result.project={id:p.id,count:p.count,progress:p.progress,
      importState:p.importState,manifestCount:p.importTaskManifest?.length,failures:p.importFailures?.length??0,
      manifestVersion:p.importTaskManifestVersion??1,
      verifiedTasks:p.importTaskManifest?.filter(row=>row.sourceVerification==='verified').length??0,
      pendingTasks:p.importTaskManifest?.filter(row=>row.sourceVerification==='pending').length??0};
    result.assets=[];const cursor=tx.objectStore('photoAssets').index('projectId').openCursor(IDBKeyRange.only(p.id));
    cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;const a=c.value;result.assets.push({id:a.id,path:a.sourcePath,
     sha:a.sourceFullSha256,revision:a.sourceContentRevision,token:a.sourceFileToken});c.continue();};
    const decisions=tx.objectStore('decisions').index('projectId').getAll(p.id);
    decisions.onsuccess=()=>{result.decisions=decisions.result.map(d=>({photoId:d.photoId,decision:d.decision,
      humanOverride:d.humanOverride,source:d.source}));};
   };
  };
 })`);}
 async function waitSnapshot(predicate,label,timeout=120000){
  const end=Date.now()+timeout;let value;
  while(Date.now()<end){value=await snapshot();if(predicate(value))return value;await delay(150);}
  throw Error(label+':'+JSON.stringify(value?.project??value));
 }
 async function markHumanKeep(){
  await until('document.querySelectorAll(".photo-tile").length>=1');
  await ev('(()=>{document.querySelector(".photo-tile").click();return true})()');await click('单图');
  await until('Boolean(document.querySelector(".single-photo-view"))');
  await ev('(()=>{document.querySelector(".single-photo-view").focus();return true})()');
  for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  return waitSnapshot(value=>value.decisions?.some(d=>d.decision==='keep'&&d.humanOverride===true),'HUMAN_KEEP_NOT_DURABLE');
 }
 async function stopApp(force){
  const previous=app;
  if(force){assert(process.platform==='win32','FORCED_CASE_WINDOWS_ONLY');
   await new Promise((resolve,reject)=>{const task=spawn('taskkill',['/PID',String(previous.pid),'/T','/F'],{stdio:'ignore'});task.on('error',reject);task.on('exit',code=>code===0?resolve():reject(Error('OWN_PROCESS_STOP_FAILED')));});
  }else await Promise.race([call('Browser.close').catch(()=>null),delay(5000)]);
  const deadline=Date.now()+15000;while(previous.exitCode===null&&previous.signalCode===null&&Date.now()<deadline)await delay(100);
  assert(previous.exitCode!==null||previous.signalCode!==null,'OWN_PROCESS_NOT_SETTLED');
  if(!force)assert(previous.exitCode===0&&previous.signalCode===null,'NORMAL_QA_EXIT_FAILED');
  for(const item of pending.values()){clearTimeout(item.t);item.reject(Error('OLD_PAGE_CLOSED'));}pending.clear();
  try{ws?.close();}catch{}
  return{pid:previous.pid,forced:force,exitCode:previous.exitCode,signal:previous.signalCode};
 }
 async function mainDirectoryPicker(folder){
  const endpoint=[...fs.readFileSync(path.join(out,'source-app.log'),'utf8').matchAll(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/g)].at(-1)?.[1];
  assert(endpoint,'RECOVERY_INSPECTOR');const socket=new WebSocket(endpoint);
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('RECOVERY_INSPECTOR_CONNECT')),10000);socket.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(t);reject(Error('RECOVERY_INSPECTOR_CONNECT'));},{once:true});});
  try{return await new Promise((resolve,reject)=>{
   const t=setTimeout(()=>reject(Error('RECOVERY_PICKER_INSTALL_TIMEOUT')),10000);
   socket.addEventListener('message',event=>{const reply=JSON.parse(event.data);if(reply.id!==1)return;clearTimeout(t);
    if(reply.error||reply.result?.exceptionDetails)reject(Error('RECOVERY_PICKER_INSTALL'));else resolve(reply.result?.result?.value);});
   const adapter=function(folder){const {dialog}=process.mainModule.require('electron');
    dialog.showOpenDialog=async(...args)=>{const options=args.at(-1);
     if(options?.title!=='选择照片文件夹'||!options.properties?.includes('openDirectory'))throw Error('UNREVIEWED_RECOVERY_PICKER');
     return{canceled:false,filePaths:[folder]};};return true;};
   socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'('+adapter.toString()+')('+JSON.stringify(folder)+')',returnByValue:true,awaitPromise:true}}));
  });}finally{socket.close();}
 }

 if(process.env.OMC_R21_INCREMENTAL==='1'){
  report.incrementalCommitBoundaries=[];
  for(const mode of ['cancel-before','force-before','force-after']){
   if(mode!=='cancel-before'){
    profile=path.join(work,'profile-'+mode);await startApp();
    await until('[...document.querySelectorAll("button")].some(e=>e.offsetWidth&&e.innerText.trim()==="使用此编号开始选片")');await click('使用此编号开始选片');
    if(await ev('Boolean(document.querySelector("button[aria-label=跳过新手引导]"))'))await click('跳过新手引导');
   }
   report.stage='incremental-'+mode;
   assert(await ev(`(async()=>{
    const {db}=await import('/src/store/db.js');
    const actual=db.commitIncrementalJpegBatch.bind(db),state={entered:false,used:false,applied:false};
    window.__OMC_INCREMENTAL_PAUSE__=state;
    db.commitIncrementalJpegBatch=async(...args)=>{
     if(state.used)return actual(...args);state.used=true;
     const pause=()=>new Promise(resolve=>{state.release=resolve;state.entered=true;});
     if(${JSON.stringify(mode)}==='force-after'){
      const result=await actual(...args);state.applied=result.applied;await pause();return result;
     }
     await pause();return actual(...args);
    };return true;
   })()`),'REAL_COMMIT_PAUSE_INSTALLED');
   await click('导入照片');assert(await installCloudImportPicker(work,files.slice(0,32),1000),'BOUNDARY_PICKER');await click('选择文件');
   await until('Boolean(window.__OMC_INCREMENTAL_PAUSE__?.entered)',120000);
   const staged=await snapshot(),expectedAssets=mode==='force-after'?12:0;
   assert(staged.project?.manifestVersion===2&&staged.project.count===expectedAssets&&staged.assets.length===expectedAssets
    &&staged.project.verifiedTasks===expectedAssets&&staged.project.pendingTasks===32-expectedAssets,'ATOMIC_BATCH_BOUNDARY');
   const prior=new Map(staged.assets.map(a=>[a.path,a]));
   const result={mode,controlledDelayOfActualCommit:true,before:staged.project,assetCount:staged.assets.length};
   if(mode==='cancel-before'){
    await click('取消导入');await ev('(()=>{window.__OMC_INCREMENTAL_PAUSE__.release();return true})()');
    await until('Boolean(document.querySelector(".import-cancel-notice"))',30000);
    result.cancelNotice=await ev('document.querySelector(".import-cancel-notice").innerText');
    await click('关闭');
   }else{result.processExit=await stopApp(true);await startApp();}
   const retained=await waitSnapshot(v=>v.project?.id===staged.project.id&&v.project.importState==='interrupted','BOUNDARY_PLAN_NOT_RETAINED');
   assert(retained.assets.length===expectedAssets&&retained.decisions.length===0,'BOUNDARY_PARTIAL_OR_INVENTED_RECORD');
   result.afterInterruption=retained.project;
   await click('项目');await until('document.querySelectorAll(".project-card-menu-button").length===1');
   await ev('(()=>{document.querySelector(".project-card-menu-button").click();return true})()');
   assert(await mainDirectoryPicker(stressDir),'BOUNDARY_DIRECTORY_ADAPTER');await click('核验原片并补全导入');
   const completed=await waitSnapshot(v=>v.project?.id===staged.project.id&&v.project.importState==='complete','BOUNDARY_RECOVERY_NOT_COMPLETE',180000);
   assert(completed.assets.length===32&&completed.project.count===32&&completed.project.pendingTasks===0
    &&completed.project.verifiedTasks===32&&completed.decisions.length===0,'BOUNDARY_RECOVERY_ACCOUNTING');
   for(const [p,old] of prior){const current=completed.assets.find(a=>a.path===p);
    assert(current&&current.id===old.id&&current.sha===old.sha&&current.revision===old.revision,'BOUNDARY_EXISTING_IDENTITY_CHANGED');}
   await until('!document.querySelector(".project-card[aria-busy=true]")&&Boolean(document.querySelector(".project-drawer-close:not(:disabled)"))',30000);
   result.recovered=completed.project;result.existingIdentitiesPreserved=prior.size;
   result.visibleWithoutRestart=mode==='cancel-before';report.incrementalCommitBoundaries.push(result);
   await stopApp(false);
  }
  profile=path.join(work,'profile-mixed');await startApp();
  await until('[...document.querySelectorAll("button")].some(e=>e.offsetWidth&&e.innerText.trim()==="使用此编号开始选片")');await click('使用此编号开始选片');
  if(await ev('Boolean(document.querySelector("button[aria-label=跳过新手引导]"))'))await click('跳过新手引导');
 }
 if(process.env.OMC_R20_RECOVERY_UI_ONLY!=='1'){
 report.stage='mixed-valid-and-damaged-import';
 const damaged=path.join(stressDir,'damaged.jpg');fs.writeFileSync(damaged,Buffer.from([255,216,255,224,0,16,74,70,73,70]));
 const mixed=[...files.slice(0,32),damaged];
 await click('导入照片');assert(await installCloudImportPicker(work,mixed,1000),'MIXED_PICKER');await click('选择文件');
 const mixedDone=await waitSnapshot(v=>v.project?.importState==='partial'&&v.project.progress===1,'MIXED_TERMINAL_ACCOUNTING',180000);
 assert(mixedDone.project.count===32&&mixedDone.project.failures===1&&mixedDone.project.manifestCount===33
   &&mixedDone.assets.length===32,'MIXED_DURABLE_COUNTS');
 const expectedNames=new Set(files.slice(0,32).map(file=>path.basename(file)));
 assert(mixedDone.assets.every(a=>expectedNames.has(String(a.path).split(/[\\/]/).at(-1)))
   &&new Set(mixedDone.assets.map(a=>a.path)).size===32,'FAILED_IMAGE_BECAME_PLACEHOLDER_ASSET');
 const mixedHuman=await markHumanKeep();
 report.mixed={project:mixedDone.project,humanDecision:mixedHuman.decisions.find(d=>d.decision==='keep'),
   allSuccessfulSourcesBound:mixedDone.assets.every(a=>a.token&&/^[a-f0-9]{64}$/.test(a.sha??'')),failedPlaceholderAssets:0};
 assert(report.mixed.allSuccessfulSourcesBound,'MIXED_MISSING_SOURCE_BINDING');
 report.mixed.normalExit=await stopApp(false);await startApp();
 const mixedRestored=await waitSnapshot(v=>v.project?.id===mixedDone.project.id&&v.decisions?.some(d=>d.photoId===report.mixed.humanDecision.photoId&&d.decision==='keep'),'MIXED_RESTART_PRESERVATION');
 assert(mixedRestored.project.count===32&&mixedRestored.project.failures===1
   &&mixedRestored.project.importState==='partial'&&mixedRestored.project.progress===1
   &&mixedRestored.project.manifestCount===33,'MIXED_RESTART_COUNTS');
 assert(mixedRestored.decisions.some(d=>JSON.stringify(d)===JSON.stringify(report.mixed.humanDecision)),'MIXED_RESTART_HUMAN_DECISION_CHANGED');
 report.mixed.restartPreserved=true;
 await stopApp(false);

 // A second isolated QA profile, with the same one Electron/runtime resource.
 // No project rows, decisions, file grants or recovery state are fabricated.
 profile=path.join(work,'profile-recovery');await startApp();
 await until('[...document.querySelectorAll("button")].some(e=>e.offsetWidth&&e.innerText.trim()==="使用此编号开始选片")');await click('使用此编号开始选片');
 if(await ev('Boolean(document.querySelector("button[aria-label=跳过新手引导]"))'))await click('跳过新手引导');
 }
 report.stage='interrupt-import';
 await click('导入照片');assert(await installCloudImportPicker(work,files,1000),'RECOVERY_PICKER');await click('选择文件');
 const importStarted=Date.now();
 const firstWave=await waitSnapshot(v=>v.project?.importState==='importing'&&v.project.count>=12,'FIRST_DURABLE_BATCH',180000);
 if(process.env.OMC_R21_INCREMENTAL==='1'){
  assert(firstWave.project.manifestVersion===2&&firstWave.project.pendingTasks>0
   &&firstWave.project.verifiedTasks===firstWave.assets.length,'FIRST_WAVE_WAITED_FOR_ALL_FULL_HASHES');
  report.firstWave={...firstWave.project,assets:firstWave.assets.length,observedElapsedMs:Date.now()-importStarted,
   inputSelectionMetadataWasAlreadyRead:true};
 }
 const before=await markHumanKeep();
 assert(before.project.count<recoveryCount&&before.project.importState==='importing','IMPORT_FINISHED_BEFORE_INTERRUPTION');
 report.interruption={project:before.project,assetCount:before.assets.length,
   humanDecision:before.decisions.find(d=>d.decision==='keep'&&d.humanOverride===true)};
 report.interruption.processExit=await stopApp(true);await startApp();
 const interrupted=await waitSnapshot(v=>v.project?.id===before.project.id&&v.project.importState==='interrupted','INTERRUPTED_PROJECT_NOT_RECOVERED');
 assert(interrupted.decisions.some(d=>JSON.stringify(d)===JSON.stringify(report.interruption.humanDecision)),'HUMAN_DECISION_LOST_ON_CRASH');
 const restoredBefore=new Map(interrupted.assets.map(a=>[a.path,a]));
 assert(restoredBefore.size===interrupted.assets.length,'PREEXISTING_SOURCE_PATH_AMBIGUITY');
 report.interruption.afterRestart={...interrupted.project,assets:interrupted.assets.length};
 report.stage='same-project-resume';
 await click('项目');await until('document.querySelectorAll(".project-card-menu-button").length===1');
 await ev('(()=>{document.querySelector(".project-card-menu-button").click();return true})()');
 assert(await mainDirectoryPicker(stressDir),'RECOVERY_DIRECTORY_ADAPTER');
 const resumeStart=Date.now();await click('核验原片并补全导入');
 const recovered=await waitSnapshot(v=>v.project?.id===before.project.id&&v.project.importState==='complete','RECOVERY_NOT_COMPLETE',600000);
 assert(recovered.project.count===recoveryCount&&recovered.project.manifestCount===recoveryCount&&recovered.assets.length===recoveryCount&&recovered.project.progress===1,'RECOVERY_FINAL_ACCOUNTING');
 assert(recovered.decisions.some(d=>JSON.stringify(d)===JSON.stringify(report.interruption.humanDecision)),'RECOVERY_CHANGED_HUMAN_DECISION');
 for(const [sourcePath,old] of restoredBefore){const next=recovered.assets.find(a=>a.path===sourcePath);
  assert(next&&next.id===old.id&&next.sha===old.sha&&next.revision===old.revision,'RECOVERY_CHANGED_EXISTING_PHOTO_IDENTITY');}
 assert(recovered.assets.every(a=>a.token&&/^[a-f0-9]{64}$/.test(a.sha??'')),'RECOVERY_MISSING_SOURCE_BINDING');
 const heap=await call('Runtime.getHeapUsage');assert(heap.usedSize<512*1024*1024,'RECOVERY_RENDERER_HEAP_BUDGET');
 report.recovered={project:recovered.project,assets:recovered.assets.length,preexistingIdentitiesPreserved:restoredBefore.size,
   humanDecisionPreserved:true,resumeElapsedMs:Date.now()-resumeStart,rendererJsHeap:heap};

 if(process.env.OMC_R20_RECOVERY_UI_ONLY==='1'||process.env.OMC_R21_INCREMENTAL==='1'){
  report.stage='actual-ui-after-recovery-commit';const uiStart=Date.now();
  await until('!document.querySelector(".project-card[aria-busy=true]")&&Boolean(document.querySelector(".project-drawer-close:not(:disabled)"))',30000);
  await click('关闭项目抽屉');await until('!document.querySelector(".project-drawer-close")');
  await until(`document.querySelector('.statusbar')?.innerText.replace(/\s+/g,' ').includes('未处理 ${recoveryCount-1}')`,30000);
  const uiBefore=await ev('document.querySelector(".statusbar").innerText');
  await click('网格');await until('document.querySelectorAll(".photo-tile").length>=2');
  assert(await ev(`(()=>{const candidates=[...document.querySelectorAll('.photo-tile')];const next=candidates.find(e=>e.innerText.includes('未处理'));if(!next)return false;next.click();return true})()`),'NEXT_UNTREATED_VISIBLE_PHOTO');
  await click('单图');await until('Boolean(document.querySelector(".single-photo-view"))');
  await ev('(()=>{document.querySelector(".single-photo-view").focus();return true})()');
  for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  const continued=await waitSnapshot(v=>v.decisions?.filter(d=>d.decision==='keep'&&d.humanOverride===true).length===2,'REVIEW_AFTER_RECOVERY_NOT_DURABLE');
  assert(continued.project.id===before.project.id&&continued.project.importState==='complete','POST_RECOVERY_REVIEW_PROJECT_CHANGED');
  await until(`document.querySelector('.statusbar')?.innerText.replace(/\s+/g,' ').includes('未处理 ${recoveryCount-2}')`,30000);
  report.uiContinuation={waitAfterCommitMs:Date.now()-uiStart,total:recoveryCount,before:uiBefore,
   after:await ev('document.querySelector(".statusbar").innerText'),realKeyboardReviewAfterRecovery:true,keepCount:2};
 }
 report.allSyntheticSourcesUnchanged=mothers.every(file=>hash(fs.readFileSync(file))===sourceHashes.get(file));
 assert(report.allSyntheticSourcesUnchanged,'SYNTHETIC_ORIGINAL_BYTES_CHANGED');
 await snap('photo-grid');report.status=process.env.OMC_R21_INCREMENTAL==='1'?'PASS_INCREMENTAL_JPEG_FIRST_WAVE_AND_COMMIT_RECOVERY':process.env.OMC_R20_RECOVERY_UI_ONLY==='1'?'PASS_SOURCE_RECOVERY_UI_CONTINUATION_128_PATHS':'PASS_SOURCE_MIXED_IMPORT_AND_INTERRUPTED_1000_PATH_RECOVERY';report.stage='done';
 report.limitations=['Source development entry, not installed package or complete AI','16 synthetic pixel sources over 1000 hardlinked paths; not 1000 independent real photos',
  'Native import/recovery picker UI answers adapted; all file grants, hashes, decodes, DB writes and recovery transactions are production paths',
  'Forced exit targets only this disposable Windows QA application; user computer untouched','Renderer JS heap is not total process/native memory'];

}catch(e){report.status='FAIL';report.error=String(e.stack||e);try{report.dom=await ev('document.body.innerText.slice(0,14000)');await snap('failure');}catch{}}
finally{
 if(originalPath&&fs.existsSync(originalPath)){report.originalAfterSha256=hash(fs.readFileSync(originalPath));report.originalUnchanged=report.originalAfterSha256===report.original?.sha256;}
 fs.writeFileSync(path.join(out,'JPEG_BEFORE_CLEANUP.json'),JSON.stringify(report,null,2));
 report.cleanup=[];
 if(process.platform==='darwin'&&ws?.readyState===WebSocket.OPEN){try{await Promise.race([call('Browser.close').catch(()=>null),delay(5000)]);}catch{}}
 for(const p of [app,vite])if(p?.pid){
  if(process.platform==='darwin'){
   const entry={pid:p.pid,role:p===app?'app':'vite',forced:false};
   for(const signal of ['SIGTERM','SIGKILL']){
    if(p.exitCode!==null||p.signalCode!==null)break;
    try{process.kill(-p.pid,signal);if(signal==='SIGKILL')entry.forced=true;}catch(e){if(e.code!=='ESRCH')entry.error=e.code;}
    const end=Date.now()+3000;while(p.exitCode===null&&p.signalCode===null&&Date.now()<end)await delay(50);
   }
   entry.exitCode=p.exitCode;entry.signal=p.signalCode;entry.settled=p.exitCode!==null||p.signalCode!==null;report.cleanup.push(entry);p.unref();
   if(!entry.settled){report.status='FAIL_CLEANUP';process.exitCode=1;}
  }else{await new Promise(resolve=>{const k=spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});k.on('exit',resolve);});}
 }
 for(const p of pending.values()){clearTimeout(p.t);p.reject(Error('TEST_FINISHED'));}pending.clear();try{ws?.close();}catch{}
 fs.writeFileSync(path.join(out,'JPEG_FUNCTIONAL.json'),JSON.stringify(report,null,2));fs.closeSync(log);
}
if(report.status==='FAIL')process.exitCode=1;

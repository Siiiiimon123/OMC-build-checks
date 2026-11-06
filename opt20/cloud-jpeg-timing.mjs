// Generic bounded cloud GUI driver. No injected results, delays or product writes.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {installCloudImportPicker} from './cloud-finished-flow.mjs';
const [source,work,fileA,fileB]=process.argv.slice(2);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(v,m)=>{if(!v)throw Error(m);};
const expected=[['sample-a',2534841,'f959a2cf7a3a787934a669dfde25ba112dec5d65f5086c77b26aad80ea664959'],['sample-b',5157560,'54f911884c2c28e7c4d9a706e0ae0675949fc8d6a249a4b9575934fbcad34314']];
const out=path.join(work,'evidence');fs.mkdirSync(out,{recursive:true});
const report={schema:'omc-cloud-jpeg-race-v1',status:'RUNNING',stage:'scope',sourceTree:process.env.OMC_QA_SOURCE_TREE,scriptDrivenRealGui:true,manualDotDesktop:false,installedPackageTested:false,completeAiTested:false,realThousandTested:false,heldOrInjectedPreviewResults:false,cleanup:[]};
const repairOnly=false;report.repairOnly=repairOnly;
if(repairOnly)report.inheritedContinuousObservation={run:42151202768,overallPriorRunPassed:false,sourceUnchanged:false,continuousDragRepeated:false,scope:'Historical nonneutral feedback only; changed display readiness needs this fresh GUI ownership check'};
let app,vite,ws,seq=0,phase='scope';const pending=new Map();
const log=fs.openSync(path.join(out,'source-app.log'),'a');
function stage(name){phase=name;report.stage=name;fs.writeFileSync(path.join(out,'PROGRESS.json'),JSON.stringify({stage:name,at:new Date().toISOString()}));console.log(JSON.stringify({stage:name}));}
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT:'+method));},30000);pending.set(id,{resolve,reject,t});ws.send(JSON.stringify({id,method,params}));});
async function ev(expression){const r=await call('Runtime.evaluate',{expression:'(async()=>{const value=await ('+expression+');return JSON.stringify(value);})()',returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('RENDERER:'+String(r.exceptionDetails.exception?.description??r.exceptionDetails.text).slice(0,1500));return JSON.parse(r.result.value);}
async function until(expression,ms=60000){const end=Date.now()+ms;while(Date.now()<end){if(await ev('Boolean(await ('+expression+'))'))return true;await delay(25);}return false;}
async function requireUntil(expression,message,ms){assert(await until(expression,ms),message);}
async function click(label){const q=JSON.stringify(label);await requireUntil(`([...document.querySelectorAll('button')].some(e=>e.offsetWidth&&!e.disabled&&(e.getAttribute('aria-label')===${q}||e.innerText.trim()===${q})))`,'BUTTON_NOT_READY:'+label,30000);const rect=await ev(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.offsetWidth&&!e.disabled&&(e.getAttribute('aria-label')===${q}||e.innerText.trim()===${q}));e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',buttons:0,clickCount:1});}
async function snap(name){const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const data=Buffer.from(shot.data,'base64');assert(data.length<=4*1024**2,'SCREENSHOT_BOUND');fs.writeFileSync(path.join(out,name+'.png'),data);}
async function enterNumber(label,value){const selector=`input[aria-label=${JSON.stringify(label+' 数值')}]`;await requireUntil(`Boolean(document.querySelector(${JSON.stringify(selector)}))`,'NUMBER_MISSING:'+label,20000);await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),d=e.closest('details');if(d&&!d.open)d.querySelector('summary').click();return true})()`);await requireUntil(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&!e.disabled&&e.offsetWidth>0})()`,'NUMBER_HIDDEN:'+label,10000);await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});e.focus();e.select();return true})()`);await call('Input.insertText',{text:String(value)});await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
async function openAdjustment(){if(await ev('Boolean(document.querySelector(".exposure-dialog"))'))return;await requireUntil(`([...document.querySelectorAll('button')].some(e=>e.offsetWidth&&!e.disabled&&(e.innerText.includes('JPEG 基础调整')||e.innerText.trim()==='调整 JPEG 参数'||e.getAttribute('aria-label')==='调整 JPEG 参数')))`,'ADJUST_ENTRY',30000);await ev(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.offsetWidth&&!e.disabled&&(e.innerText.includes('JPEG 基础调整')||e.innerText.trim()==='调整 JPEG 参数'||e.getAttribute('aria-label')==='调整 JPEG 参数'));e.click();return true})()`);await requireUntil('Boolean(document.querySelector(".exposure-dialog"))','ADJUST_OPEN',30000);}
const refinedReady=`(()=>{const s=document.querySelector('.exposure-dialog'),i=document.querySelector('.single-photo-view .highres-viewer[data-adjustment-preview=effect] img'),b=[...document.querySelectorAll('.exposure-dialog button')].find(e=>e.getAttribute('aria-label')?.startsWith('保存'));return s&&s.dataset.previewQuality==='refined'&&s.getAttribute('aria-busy')==='false'&&i?.complete&&i.naturalWidth>0&&b&&!b.disabled})()`;
async function settle(){await requireUntil(refinedReady,'REFINED_NOT_READY',180000);await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');}
async function ui(){return ev(`(()=>{const s=document.querySelector('.exposure-dialog'),v=label=>Number(s?.querySelector('input[type=range][aria-label="'+label+'"]')?.value),i=document.querySelector('.single-photo-view .highres-viewer[data-adjustment-preview=effect] img'),b=[...document.querySelectorAll('.exposure-dialog button')].find(e=>e.getAttribute('aria-label')?.startsWith('保存'));return{at:performance.now(),photoId:document.querySelector('.single-photo-view')?.dataset.reviewPhotoId,quality:s?.dataset.previewQuality,backend:s?.dataset.previewBackend,busy:s?.getAttribute('aria-busy'),saveDisabled:b?.disabled,ev:v('曝光 EV'),saturation:v('饱和度百分比'),texture:v('纹理强度'),width:i?.naturalWidth,height:i?.naturalHeight,displayWidth:i?.clientWidth,displayHeight:i?.clientHeight,devicePixelRatio:window.devicePixelRatio,alerts:[...document.querySelectorAll('.exposure-dialog [role=alert]')].map(e=>e.innerText)}})()`);}
try{
 assert(['win32','darwin'].includes(process.platform)&&report.sourceTree==='2403c7bffccb40dadfcc7738af175f5ac6a8024f'&&process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks'&&process.env.GITHUB_REF==='refs/heads/verify-optimization20','CLOUD_SCOPE');
 const files=[fileA,fileB];report.inputs=files.map((f,i)=>{const data=fs.readFileSync(f),[id,bytes,sha256]=expected[i];assert(data.length===bytes&&hash(data)===sha256,'PHOTO_BYTES:'+id);return{id,bytes,sha256};});
 stage('launch');const env={...process.env};for(const k of ['OMC_PREVIEW15_TRANSPORT_KEY','GH_TOKEN','GITHUB_TOKEN','ELECTRON_RUN_AS_NODE'])delete env[k];
 vite=spawn(process.execPath,[path.join(source,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5173','--strictPort'],{cwd:source,env,stdio:['ignore',log,log],detached:process.platform==='darwin'});
 let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch('http://127.0.0.1:5173')).ok;if(ready)break;}catch{}await delay(100);}assert(ready,'VITE_READY');
 const profile=path.join(work,'profile'),binary=process.platform==='darwin'?'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron':'node_modules/electron/dist/electron.exe';app=spawn(path.join(source,binary),['--inspect=127.0.0.1:0',source,'--user-data-dir='+profile,'--remote-debugging-port=0','--no-first-run'],{cwd:source,env,stdio:['ignore',log,log],detached:process.platform==='darwin'});
 let target;for(let i=0;i<240;i++){try{const port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page'&&t.url.startsWith('http://localhost:5173'));if(target)break;}catch{}await delay(200);}assert(target,'SOURCE_WINDOW');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{const t=setTimeout(()=>j(Error('CDP_CONNECT')),10000);ws.addEventListener('open',()=>{clearTimeout(t);r();},{once:true});ws.addEventListener('error',e=>{clearTimeout(t);j(e);},{once:true});});ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await requireUntil('document.readyState!=="loading"&&document.querySelector("#root")?.innerText.length>40','SOURCE_DOM');
 stage('import-two-authorized-photos');await click('使用此编号开始选片');if(await ev('Boolean(document.querySelector("button[aria-label=跳过新手引导]"))'))await click('跳过新手引导');await click('导入照片');assert(await installCloudImportPicker(work,files),'IMPORT_PICKER_ADAPTER');await click('选择文件');await requireUntil('document.querySelectorAll(".photo-tile").length===2','PHOTO_READY',90000);
 if(await ev('Boolean(document.querySelector("button[aria-label=跳过新手引导]"))'))await click('跳过新手引导');await ev('(()=>{document.querySelector(".photo-tile").click();return true})()');await click('单图');await requireUntil('Boolean(document.querySelector(".single-photo-view"))','SINGLE_VIEW');await click('跳转到 sample-a.jpg');
 stage('observe-real-preview-calls');
 await ev(`(async()=>{const {photoSelectionService:s}=await import('/src/services/photoSelectionService.js');window.__qaService=s;window.__jpegRace={calls:[],frames:[],hashWork:[]};const q=window.__jpegRace,original=s.previewJpegExposure;
 const sha=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
 s.previewJpegExposure=function(...args){const row={n:q.calls.length,projectId:args[0],photoId:args[1],input:args[2],quality:args[3]?.previewQuality,start:performance.now(),finish:null};q.calls.push(row);return original.apply(this,args).then(result=>{row.finish=performance.now();row.outcome='success';row.recipe=result.recipe;row.timing=result.previewTiming;row.processingDimensions=result.report.processingDimensions;row.cacheHit=result.report.sourceProxyCacheHit;row.resultPhotoId=result.context.photoId;row.abortedAtReturn=Boolean(args[3]?.signal?.aborted);row.resultBytes=result.previewBlob.size;return result;},error=>{row.finish=performance.now();row.outcome='error';row.errorName=error.name;row.errorCode=error.code;row.aborted=Boolean(args[3]?.signal?.aborted);throw error;});};
 let previous='',lastSource=null,imageSerial=0;q.sample=()=>{
 const s=document.querySelector('.exposure-dialog'),i=document.querySelector('.single-photo-view .highres-viewer[data-adjustment-preview=effect] img');
 if(!s||!i||q.frames.length>=500)return;
 const b=[...s.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')?.startsWith('保存')),
 photoId=document.querySelector('.single-photo-view')?.dataset.reviewPhotoId,src=i.currentSrc||i.src;
 if(src!==lastSource){lastSource=src;imageSerial++;}
 const signature=[photoId,s.dataset.previewQuality,s.getAttribute('aria-busy'),b?.disabled,imageSerial].join('|');
 if(signature===previous)return;previous=signature;
 const get=label=>Number(s.querySelector('input[type=range][aria-label="'+label+'"]')?.value);
 q.frames.push({at:performance.now(),photoId,quality:s.dataset.previewQuality,busy:s.getAttribute('aria-busy'),saveDisabled:b?.disabled,
 ev:get('曝光 EV'),saturation:get('饱和度百分比'),texture:get('纹理强度'),width:i.naturalWidth,imageSerial});
 };q.observer=new MutationObserver(q.sample);q.observer.observe(document.body,{subtree:true,attributes:true,childList:true,attributeFilter:['src','aria-busy','disabled','data-preview-quality','data-preview-backend','data-review-photo-id']});q.restore=()=>{s.previewJpegExposure=original;q.observer.disconnect();};return true;})()`);
 await openAdjustment();await settle();report.aId=await ev('document.querySelector(".single-photo-view").dataset.reviewPhotoId');report.initial=await ui();assert(!report.initial.alerts.length,'INITIAL_ALERT');
 if(!repairOnly){
 stage('continuous-nonneutral-adjustment');await enterNumber('饱和度百分比',115);await settle();
 const bounds=await ev(`(()=>{const e=document.querySelector('input[type=range][aria-label="曝光 EV"]');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);assert(bounds.width>50,'RANGE_VISIBLE');const y=bounds.y+bounds.height/2;
 await call('Input.dispatchMouseEvent',{type:'mousePressed',x:bounds.x+bounds.width*.51,y,button:'left',buttons:1,clickCount:1});
 for(const fraction of [.54,.58,.63,.57,.52,.60,.65,.55,.59,.62]){await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:bounds.x+bounds.width*fraction,y,button:'left',buttons:1});await delay(90);}
 report.duringDrag=await ui();await snap('jpeg-race-continuous');await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:bounds.x+bounds.width*.62,y,button:'left',buttons:0,clickCount:1});await settle();report.afterDrag=await ui();assert(!report.afterDrag.alerts.length&&report.afterDrag.saturation===115,'CONTINUOUS_DRAFT');
 }else{stage('necessary-nonneutral-switch-setup');await enterNumber('曝光 EV',.6);await enterNumber('饱和度百分比',115);}

 await ev('(async()=>{const q=window.__jpegRace;q.sample();q.observer.disconnect();await Promise.all(q.hashWork);return true})()');
 report.calls=await ev('window.__jpegRace.calls');report.frames=await ev('window.__jpegRace.frames');
 report.intermediateFrames=report.frames.filter(f=>f.photoId===report.aId&&f.quality==='interactive').length;
 report.distinctAFrames=new Set(report.frames.filter(f=>f.photoId===report.aId).map(f=>f.imageSerial)).size;
 assert(report.intermediateFrames>0&&report.distinctAFrames>1,'NO_CONTINUOUS_REAL_FEEDBACK');
 assert(report.duringDrag.width===report.afterDrag.width&&report.duringDrag.height===report.afterDrag.height,'POINT_DRAG_DOWNSAMPLED_DISPLAY');
 report.timingObservations=report.calls.filter(c=>c.outcome==='success').map(c=>{
  return {quality:c.quality,totalServiceMs:c.finish-c.start,timing:c.timing,processingDimensions:c.processingDimensions,
    cacheHit:c.cacheHit,displayObservedMs:null};
 });
 report.status='PASS_SOURCE_CONTINUOUS_JPEG_TIMING_OBSERVED';stage('done');
}catch(error){report.status='FAIL';report.error=String(error.stack??error);report.failedStage=phase;try{report.lastUi=await ui();report.dom=await ev('document.body.innerText.slice(0,9000)');report.calls=await ev('window.__jpegRace?.calls??[]');report.frames=await ev('window.__jpegRace?.frames??[]');}catch{}}
finally{
 report.originalsUnchanged=[fileA,fileB].every((f,i)=>fs.existsSync(f)&&hash(fs.readFileSync(f))===expected[i][2]);if(!report.originalsUnchanged)report.status='FAIL_ORIGINAL_IDENTITY';
 for(const p of [app,vite])if(p?.pid){const entry={role:p===app?'app':'vite',pid:p.pid};
  if(process.platform==='darwin'){for(const signal of ['SIGTERM','SIGKILL']){if(p.exitCode!==null||p.signalCode!==null)break;try{process.kill(-p.pid,signal);}catch(e){if(e.code!=='ESRCH')entry.error=e.code;}const end=Date.now()+3000;while(p.exitCode===null&&p.signalCode===null&&Date.now()<end)await delay(50);}}
  else if(p.exitCode===null&&p.signalCode===null){await new Promise(resolve=>{const k=spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});k.on('error',()=>resolve());k.on('exit',()=>resolve());});const deadline=Date.now()+5000;while(p.exitCode===null&&p.signalCode===null&&Date.now()<deadline)await delay(50);}
  entry.exitCode=p.exitCode;entry.signal=p.signalCode;entry.settled=p.exitCode!==null||p.signalCode!==null;report.cleanup.push(entry);if(!entry.settled)report.status='FAIL_PROCESS_CLEANUP';}
 try{ws?.close();}catch{}for(const p of pending.values()){clearTimeout(p.t);p.resolve({});}pending.clear();fs.closeSync(log);fs.writeFileSync(path.join(out,'JPEG_RACE.json'),JSON.stringify(report,null,2));
}
if(report.status.startsWith('FAIL'))process.exitCode=1;

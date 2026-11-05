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
 const profile=path.join(work,'profile');
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
 report.stressScope={logicalInputs:1000,uniquePixelSources:16,syntheticOnly:true,hardlinks:true,
  physicalSourceBytes,osPageCacheBenefits:true,realPhotoThroughputQualified:false,aiThroughputQualified:false};
 report.syntheticOnly=true;report.memberDataUsed=false;
 await click('导入照片');assert(await installCloudImportPicker(work,files,1000),'STRESS_NATIVE_PICKER');
 const start=Date.now();await click('选择文件');
 function readStressDb(full=false){
  return new Promise((resolve,reject)=>{
   const open=indexedDB.open('omc-photo-select');open.onerror=()=>reject(open.error);
   open.onupgradeneeded=()=>{open.transaction.abort();reject(Error('DB_NOT_READY'));};
   open.onsuccess=()=>{
    const db=open.result;let result=null;
    const tx=db.transaction(full?['projects','photoAssets']:['projects'],'readonly');
    tx.onerror=()=>{db.close();reject(tx.error);};tx.onabort=()=>{db.close();reject(tx.error??Error('DB_ABORT'));};
    tx.oncomplete=()=>{db.close();resolve(result);};
    const read=tx.objectStore('projects').getAll();read.onsuccess=()=>{
     if(!read.result.length)return;if(read.result.length!==1){tx.abort();return;}
     const p=read.result[0];result={id:p.id,count:p.count,progress:p.progress,importState:p.importState,
      failures:p.importFailures?.length??0,manifestCount:p.importTaskManifest?.length??0};
     if(!full)return;result.assets=0;result.thumbnailBytes=0;result.analysisBytes=0;result.originalBlobBytes=0;result.missingIdentity=0;
     const cursor=tx.objectStore('photoAssets').index('projectId').openCursor(IDBKeyRange.only(p.id));
     cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;const a=c.value;result.assets++;
      result.thumbnailBytes+=a.thumbnailBlob?.size??0;result.analysisBytes+=a.analysisBlob?.size??0;
      result.originalBlobBytes+=a.originalBlob?.size??0;
      if(!a.sourceFileToken||!/^[a-f0-9]{64}$/i.test(a.sourceFullSha256??''))result.missingIdentity++;c.continue();};
    };
   };
  });
 }
 const samples=[];let lastCount=-1,lastAdvance=Date.now(),done=false;
 report.stage='stress-real-import-ipc';
 while(Date.now()-start<12*60*1000){
  const state=await ev('('+readStressDb.toString()+')(false)'),heap=await call('Runtime.getHeapUsage');
  const disk=fs.statfsSync(work),available=Number(disk.bavail)*Number(disk.bsize);
  samples.push({elapsedMs:Date.now()-start,state,rendererJsHeap:heap,availableDiskBytes:available});
  fs.writeFileSync(path.join(out,'STRESS_PROGRESS.json'),JSON.stringify({scope:report.stressScope,samples}));
  if(state?.count!==lastCount){lastCount=state?.count;lastAdvance=Date.now();}
  assert(heap.usedSize<512*1024*1024,'STOP_RENDERER_JS_HEAP_BUDGET');assert(available>2*1024**3,'STOP_VM_DISK_FLOOR');
  assert(Date.now()-lastAdvance<90000,'STOP_IMPORT_NO_PROGRESS');
  if(state&&['partial','interrupted'].includes(state.importState))throw Error('STRESS_IMPORT_TERMINAL_FAILURE:'+JSON.stringify(state));
  if(state?.importState==='complete'&&state.count===1000){done=true;break;}await delay(2000);
 }
 assert(done,'STOP_IMPORT_12_MINUTES');report.stressFinal=await ev('('+readStressDb.toString()+')(true)');
 assert(report.stressFinal.assets===1000&&report.stressFinal.manifestCount===1000&&report.stressFinal.progress===1
  &&!report.stressFinal.failures&&!report.stressFinal.missingIdentity,'STRESS_DURABLE_ROWS_MISMATCH');
 report.stressElapsedMs=Date.now()-start;report.status='PASS_SOURCE_1000_PATH_IMPORT_STRESS';report.stage='done';
 report.limitations=['16 synthetic pixel sources hardlinked to 1000 paths; OS page cache benefits',
  'No complete AI or real-thousand-photo/GPU throughput claim','Renderer heap is not total process RSS'];

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
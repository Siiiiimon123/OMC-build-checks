// Cloud-only task-scheduling measurement. No photos, model or database fixture.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const [source,work]=process.argv.slice(2),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(ok,message)=>{if(!ok)throw Error(message);};
check(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks'
 &&process.env.GITHUB_REF==='refs/heads/verify-optimization20'&&['win32','darwin'].includes(process.platform),'CLOUD_SCOPE');
const evidence=path.join(work,'evidence');fs.mkdirSync(evidence,{recursive:true});
const report={schema:'omc-analysis-yield-native-comparison-v1',status:'RUNNING',platform:process.platform,
 photosUsed:false,aiTested:false,realThousandPhotoQualified:false,gpuPerformanceQualified:false,installedPackageTested:false};
const env={...process.env};for(const name of ['OMC_PREVIEW15_TRANSPORT_KEY','GH_TOKEN','GITHUB_TOKEN','ELECTRON_RUN_AS_NODE'])delete env[name];
const log=fs.openSync(path.join(evidence,'source-app.log'),'a');let app,vite,ws,serial=0;const pending=new Map();
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++serial;
 const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT:'+method));},60000);
 pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const value=await call('Runtime.evaluate',{expression:'(async()=>JSON.stringify(await ('+expression+')))()',returnByValue:true,awaitPromise:true});
 if(value.exceptionDetails)throw Error('RENDERER_EXCEPTION:'+JSON.stringify(value.exceptionDetails).slice(0,1000));return JSON.parse(value.result.value);}
try{
 vite=spawn(process.execPath,[path.join(source,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5173','--strictPort'],{cwd:source,env,stdio:['ignore',log,log],detached:process.platform==='darwin'});
 let ready=false;for(let n=0;n<100;n++){try{ready=(await fetch('http://127.0.0.1:5173')).ok;if(ready)break;}catch{}await sleep(200);}check(ready,'VITE_NOT_READY');
 const profile=path.join(work,'profile'),binary=process.platform==='win32'?'node_modules/electron/dist/electron.exe':'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
 app=spawn(path.join(source,binary),[source,'--user-data-dir='+profile,'--remote-debugging-port=0','--no-first-run'],{cwd:source,env,stdio:['ignore',log,log],detached:process.platform==='darwin'});
 let target;for(let n=0;n<160;n++){try{const port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();target=pages.find(p=>p.type==='page'&&p.url.startsWith('http://localhost:5173'));if(target)break;}catch{}await sleep(250);}check(target,'NORMAL_SOURCE_ENTRY_NOT_READY');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP_OPEN_TIMEOUT')),10000);
 ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP_OPEN_FAILED'));},{once:true});});
 ws.addEventListener('message',event=>{const value=JSON.parse(event.data),item=pending.get(value.id);if(!item)return;pending.delete(value.id);clearTimeout(item.timer);value.error?item.reject(Error(JSON.stringify(value.error))):item.resolve(value.result);});
 await call('Runtime.enable');report.browser=await call('Browser.getVersion');
 report.environment=await evaluate('({nativeYieldAvailable:typeof globalThis.scheduler?.yield==="function",hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory??null,visibility:document.visibilityState})');
 check(report.environment.nativeYieldAvailable,'NATIVE_YIELD_NOT_AVAILABLE_NO_SPEED_CLAIM');
 report.trials=[];
 for(const mode of ['timer','native','native','timer']){
  report.trials.push(await evaluate(`(async()=>{
   const {yieldToAnalysisEventLoop:yieldTask}=await import('/src/services/analysisPerformance.js');
   const start=performance.now();let checksum=0;
   for(let i=0;i<1000;i++){
    for(let k=0;k<64;k++)checksum=(checksum+((i*17+k*31)%999983))|0;
    if(${JSON.stringify(mode)}==='timer')await yieldTask(null,callback=>setTimeout(callback,0));else await yieldTask();
   }
   return {mode:${JSON.stringify(mode)},yields:1000,checksum,elapsedMs:performance.now()-start};
  })()`));
 }
 check(report.trials.every(t=>t.checksum===report.trials[0].checksum),'COMPARISON_WORKLOAD_CHANGED');
 // A real input event must cancel a still-running native-yield loop. This is a
 // disposable QA control, not a claim about an untested photo-analysis button.
 const point=await evaluate(`(async()=>{
  const {yieldToAnalysisEventLoop:yieldTask}=await import('/src/services/analysisPerformance.js');
  const controller=new AbortController();window.__yieldProbe={count:0,clicked:false,settled:false,completed:false};
  const button=document.createElement('button');button.textContent='Cancel QA scheduling';button.id='omc-qa-yield-cancel';
  Object.assign(button.style,{position:'fixed',left:'20px',top:'20px',width:'220px',height:'60px',zIndex:'2147483647'});
  button.onclick=()=>{window.__yieldProbe.clicked=true;controller.abort(Object.assign(new Error('QA_INPUT_CANCEL'),{name:'AbortError'}));};document.body.append(button);
  const guard=setTimeout(()=>controller.abort(new Error('QA_DEADLINE')),15000);
  window.__yieldPromise=(async()=>{try{for(let i=0;i<50000;i++){await yieldTask(controller.signal);window.__yieldProbe.count++;}window.__yieldProbe.completed=true;}
   catch(error){window.__yieldProbe.error=error.message;window.__yieldProbe.errorName=error.name;}
   finally{clearTimeout(guard);window.__yieldProbe.settled=true;}})();
  const r=button.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};
 })()`);
 for(let n=0;n<100;n++){if(await evaluate('window.__yieldProbe.count>=20||window.__yieldProbe.settled'))break;await sleep(10);}
 for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...point,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});
 for(let n=0;n<100;n++){if(await evaluate('window.__yieldProbe.settled'))break;await sleep(10);}
 report.realInputCancellation=await evaluate('window.__yieldProbe');
 check(report.realInputCancellation.clicked&&report.realInputCancellation.settled&&!report.realInputCancellation.completed
  &&report.realInputCancellation.error==='QA_INPUT_CANCEL'&&report.realInputCancellation.errorName==='AbortError','REAL_INPUT_CANCEL_DID_NOT_STOP_LOOP');
 report.rendererJsHeap=await call('Runtime.getHeapUsage');
 report.status='PASS_NATIVE_TASK_YIELD_COMPARISON_AND_INPUT_CANCEL';
 report.limitations=['Normal source Electron renderer, not installed package','1000 scheduling boundaries with identical arithmetic, not 1000 photos or full AI',
  'ABBA within one VM; no guarantee for every machine, hidden window or workload','Actual click targets a disposable QA control, not the product cancel workflow',
  'Renderer JS heap snapshot is not total process/native memory'];
}catch(error){report.status='FAIL';report.error=String(error.stack||error);}
finally{
 report.cleanup=[];
 for(const child of [app,vite])if(child?.pid){
  if(process.platform==='win32')await new Promise(resolve=>{const task=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});task.on('exit',resolve);task.on('error',resolve);});
  else{for(const signal of ['SIGTERM','SIGKILL']){if(child.exitCode!==null||child.signalCode!==null)break;try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')report.cleanup.push({pid:child.pid,error:error.code});}
   const end=Date.now()+3000;while(child.exitCode===null&&child.signalCode===null&&Date.now()<end)await sleep(30);}}
  const settled=child.exitCode!==null||child.signalCode!==null;report.cleanup.push({pid:child.pid,settled,exitCode:child.exitCode,signal:child.signalCode});
  if(!settled)report.status='FAIL_OWNED_PROCESS_CLEANUP';
 }
 for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('QA_FINISHED'));}pending.clear();try{ws?.close();}catch{}
 fs.writeFileSync(path.join(evidence,'ANALYSIS_YIELD.json'),JSON.stringify(report,null,2));fs.closeSync(log);
}
if(!report.status.startsWith('PASS_'))process.exitCode=1;

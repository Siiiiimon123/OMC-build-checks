import {installBeforeMain} from './paused-main.mjs';
import fs from'node:fs';import path from'node:path';import os from'node:os';import{spawn,execFileSync}from'node:child_process';
export async function inspector(endpoint){const ws=new WebSocket(endpoint),pending=new Map();let seq=0;await new Promise((y,n)=>{const timer=setTimeout(()=>n(Error('MAIN_INSPECTOR_CONNECT_TIMEOUT')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);y();},{once:true});ws.addEventListener('error',e=>{clearTimeout(timer);n(e);},{once:true});});ws.addEventListener('message',event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.n(Error('MAIN_INSPECTOR_PROTOCOL_ERROR')):p.y(m.result);}});return{async evaluate(expression){const r=await new Promise((y,n)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);n(Error('MAIN_INSPECTOR_TIMEOUT'));},10000);pending.set(id,{y,n,timer});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});if(r.exceptionDetails)throw Error('MAIN_INSPECTOR_EVALUATION_FAILED');return r.result.value;},close(){for(const p of pending.values()){clearTimeout(p.timer);p.n(Error('MAIN_INSPECTOR_CLOSED'));}pending.clear();ws.close();},async closeAndWait(){this.close();if(ws.readyState===WebSocket.CLOSED)return;await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('MAIN_INSPECTOR_CLOSE_TIMEOUT')),5000);ws.addEventListener('close',()=>{clearTimeout(t);resolve();},{once:true});});}};}
export const delay=ms=>new Promise(r=>setTimeout(r,ms));

export async function waitForSnapshot(client,snapshot,predicate,timeout=60000,interval=150){
 const deadline=Date.now()+timeout;
 while(true){
  const value=await client.evaluate(snapshot);
  if(predicate(value))return value;
  const remaining=deadline-Date.now();if(remaining<=0)break;
  await delay(Math.min(interval,remaining));
 }
 throw Error('UI_DB_SNAPSHOT_WAIT_TIMEOUT');
}
export async function launch(app,profile=fs.mkdtempSync(path.join(os.tmpdir(),'omc-mac-native-'))){const qaRoute=JSON.parse(fs.readFileSync(process.env.OMC_QA_ROUTE_FILE,'utf8'));
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('NATIVE_MAC_ARM64_REQUIRED');
 profile=fs.realpathSync(profile);
 const exe=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleExecutable',path.join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim();
 const existing=execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n').filter(l=>l.includes(app+'/Contents/MacOS/'));if(existing.length)throw Error('EXISTING_TARGET_APP_PROCESS');
 const env={...process.env,PATH:'/usr/bin:/bin:/usr/sbin:/sbin'};for(const k of Object.keys(env))if(/^(PYTHON|NODE_|OMC_|VITE_|VIRTUAL_ENV|ELECTRON_RUN_AS_NODE)/i.test(k))delete env[k];
 const child=spawn(path.join(app,'Contents/MacOS',exe),['--inspect-brk=127.0.0.1:0','--user-data-dir='+profile,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env,stdio:['ignore','pipe','pipe']});
 let closed=false,log='';const ended=new Promise(r=>child.once('close',(code,signal)=>{closed=true;r({code,signal});}));
 for(const stream of[child.stdout,child.stderr])stream.on('data',b=>{if(log.length<1048576)log+=b.toString();});
 const endpoint=path.join(profile,'DevToolsActivePort');let ws,seq=0;const pending=new Map();
 async function connect(){
  const end=Date.now()+60000;let target;
  while(Date.now()<end&&!closed){try{const port=Number(fs.readFileSync(endpoint,'utf8').split('\n')[0]);const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();target=pages.find(x=>x.type==='page'&&x.url.startsWith('file:')&&x.url.includes('/dist/index.html'));if(target)break;}catch{}await delay(150);}
  if(!target)throw Error('NORMAL_PACKAGED_PAGE_NOT_READY');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((y,n)=>{ws.addEventListener('open',y,{once:true});ws.addEventListener('error',n,{once:true});});
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.n(Error(JSON.stringify(m.error))):p.y(m.result);}});
 }
 const call=(method,params={})=>new Promise((y,n)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);n(Error('CDP_TIMEOUT:'+method));},30000);pending.set(id,{y,n,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 async function until(expression,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){const r=await evaluate(expression);if(r)return r;await delay(150);}throw Error('UI_WAIT_TIMEOUT:'+expression.slice(0,140));}
 async function click(name,role='button',optional=false){return evaluate('('+((name,role,optional)=>{const q=role==='button'?'button':'[role="'+role+'"]';const e=[...document.querySelectorAll(q)].find(x=>x.getBoundingClientRect().width>0&&(x.getAttribute('aria-label')===name||x.innerText.trim()===name));if(!e){if(optional)return false;throw Error('UI_CONTROL_MISSING:'+name);}if(e.disabled)throw Error('UI_CONTROL_DISABLED:'+name);e.click();return true;}).toString()+')('+JSON.stringify(name)+','+JSON.stringify(role)+','+optional+')');}
 function processRows(){return execFileSync('/bin/ps',['-axo','pid=,ppid=,lstart=,comm='],{encoding:'utf8'}).trim().split('\n').map(l=>{const p=l.trim().split(/\s+/);return{pid:Number(p[0]),ppid:Number(p[1]),identity:p.slice(2).join(' ')};});}
 let mainInspector; async function mainEvaluate(expression){if(!mainInspector){const end=Date.now()+10000;let endpoint;while(Date.now()<end){endpoint=log.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];if(endpoint)break;await delay(100);}if(!endpoint)throw Error('NORMAL_MAIN_INSPECTOR_UNAVAILABLE');mainInspector=await inspector(endpoint);}return mainInspector.evaluate(expression);} 
 async function mainEvaluateOnce(expression){try{return await mainEvaluate(expression);}finally{if(mainInspector){await mainInspector.closeAndWait();mainInspector=undefined;}}}
 async function close(){
  mainInspector?.close();
  const before=processRows(),owned=new Set([child.pid]);for(let i=0;i<12;i++)for(const r of before)if(owned.has(r.ppid))owned.add(r.pid);
  const descendants=before.filter(r=>r.pid!==child.pid&&owned.has(r.pid));
  let normal=true;try{await call('Browser.close');}catch{}await Promise.race([ended,delay(15000)]);
  if(!closed){normal=false;child.kill('SIGTERM');await Promise.race([ended,delay(5000)]);}
  if(!closed){child.kill('SIGKILL');await Promise.race([ended,delay(5000)]);}
  let surviving=[];const end=Date.now()+15000;do{const rows=processRows();surviving=descendants.filter(r=>rows.some(n=>n.pid===r.pid&&n.identity===r.identity));if(!surviving.length)break;await delay(150);}while(Date.now()<end);
  const descendantsSettled=surviving.length===0;
  for(const r of surviving){const current=processRows().find(n=>n.pid===r.pid&&n.identity===r.identity);if(current)try{process.kill(r.pid,'SIGKILL');}catch{}}
  try{ws?.close();}catch{}return{...await Promise.race([ended,delay(5000).then(()=>({code:null,signal:"UNREAPED_TIMEOUT"}))]),normalBrowserClose:normal,descendantsSettled,ownedDescendants:descendants,cleanupKilled:surviving,log,profile,pid:child.pid};
 }
 try{const routeDeadline=Date.now()+15000;let routeEndpoint;while(Date.now()<routeDeadline){routeEndpoint=log.split(String.fromCharCode(10)).find(x=>x.includes("Debugger listening on ws://127.0.0.1:"))?.trim().split(" ").at(-1);if(routeEndpoint)break;await delay(50);}if(!routeEndpoint)throw Error('PRE_MAIN_ENDPOINT_MISSING');await installBeforeMain(routeEndpoint,qaRoute);await connect();await call('Runtime.enable');await until('document.readyState==="complete"&&document.getElementById("root")?.childElementCount>0');return{child,profile,call,evaluate,until,click,close,mainEvaluate,mainEvaluateOnce};}
 catch(e){if(!closed){child.kill('SIGTERM');await Promise.race([ended,delay(5000)]);if(!closed){child.kill('SIGKILL');await Promise.race([ended,delay(5000)]);}}throw e;}
}

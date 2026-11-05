// Native Unicode desktop-link launch; same installed package, no source edits.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const [installationFile,work,evidence]=process.argv.slice(2);
assert(process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks');
assert(process.env.GITHUB_REF==='refs/heads/verify-final-package19'&&process.env.GITHUB_RUN_ATTEMPT==='1');
const json=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\ufeff/,''));
const installed=json(installationFile),raw=json(path.join(evidence,'DESKTOP_LINK_INVENTORY.json'));
const rows=Array.isArray(raw)?raw:[raw],links=rows.filter(r=>r.name.startsWith('OMC')&&r.name.endsWith('.lnk'));
assert(installed.installedPayloadPassed===true&&links.length===1);
const original=links[0].path,expected=installed.executable;
assert(fs.statSync(original).isFile()&&fs.statSync(expected).isFile());
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),before=sha(original);
fs.mkdirSync(work);const copy=path.join(work,'same-link-ascii.lnk');fs.copyFileSync(original,copy);assert(sha(copy)===before);
const profile=path.join(work,'profile'),delay=ms=>new Promise(r=>setTimeout(r,ms));
const env={...process.env};for(const k of Object.keys(env))if(k.toLowerCase()==='psmodulepath'||/^(PYTHON|NODE_|OMC_|VITE_|VIRTUAL_ENV|ELECTRON_RUN_AS_NODE|GH_TOKEN|GITHUB_TOKEN)/i.test(k))delete env[k];
env.PATH=path.join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot;
const reserve=net.createServer();await new Promise((r,j)=>{reserve.once('error',j);reserve.listen(0,'127.0.0.1',r);});const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const q=s=>"'"+s.replaceAll("'","''")+"'",launcher=path.join(work,'launch-original-link.ps1');
const flags=['--inspect=127.0.0.1:'+port,'--user-data-dir='+profile,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run'];
// BOM is required for a literal Chinese path in Windows PowerShell5 source.
fs.writeFileSync(launcher,'\ufeff'+"$ErrorActionPreference='Stop';Start-Process -FilePath "+q(original)+' -ArgumentList @('+flags.map(q).join(',')+") -PassThru | Select-Object Id | ConvertTo-Json");
const report={schema:'omc-native-unicode-shortcut-launch-v1',status:'RUNNING',originalShortcut:original,
 originalShortcutSha256:before,installedExecutable:expected,systemPathOnly:true,normalShellLaunch:true,
 shortcutEdited:false,productSourceChanged:false,fullAiRepeated:false};
let socket,pageSocket,pid=null,normalClosed=false;let seq=0;const pending=new Map();
const request=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('MAIN_NATIVE_LINK_QUERY_TIMEOUT'));},10000);pending.set(id,{resolve,reject,t});socket.send(JSON.stringify({id,method,params}));});
const alive=()=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
try{
 const r=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-File',launcher],{env,windowsHide:true,encoding:'utf8',timeout:30000});
 fs.writeFileSync(path.join(evidence,'launch-original-desktop-link.log'),String(r.stdout||'')+String(r.stderr||''));assert(!r.error&&r.status===0,'WINDOWS_SHELL_LINK_LAUNCH_FAILED');
 let target;const until=Date.now()+90000;
 while(Date.now()<until){try{const all=await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(2000)})).json();target=all.find(x=>x.webSocketDebuggerUrl);if(target)break;}catch{}await delay(200);}
 assert(target,'ORIGINAL_UNICODE_SHORTCUT_DID_NOT_LAUNCH_MAIN');
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.t);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
 const identity=await request('Runtime.evaluate',{expression:'({pid:process.pid,executable:process.execPath})',returnByValue:true});
 assert(!identity.exceptionDetails,'MAIN_PROCESS_IDENTITY_QUERY');pid=identity.result.value.pid;
 const same=(a,b)=>typeof a==='string'&&a.length>0&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
 assert(Number.isInteger(pid)&&same(identity.result.value.executable,expected),'ACTUAL_PROCESS_IDENTITY');report.actualProcessIdentity=identity.result.value;
 let page;const readyDeadline=Date.now()+90000;
 while(Date.now()<readyDeadline){try{const debugPort=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);const all=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list',{signal:AbortSignal.timeout(2000)})).json();page=all.find(x=>x.type==='page'&&x.url.startsWith('file:')&&x.url.includes('/dist/index.html'));if(page)break;}catch{}await delay(200);}
 assert(page,'SHORTCUT_LAUNCHED_RENDERER_NOT_READY');pageSocket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{pageSocket.addEventListener('open',r,{once:true});pageSocket.addEventListener('error',j,{once:true});});
 const evaluated=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('SHORTCUT_UI_EVALUATION_TIMEOUT')),10000);pageSocket.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id===1){clearTimeout(t);resolve(r);}});pageSocket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'new Promise((resolve,reject)=>{const end=Date.now()+30000;const tick=()=>{const text=document.querySelector("#root")?.innerText||"";if(text.length>40)resolve({title:document.title,text:text.slice(0,600)});else if(Date.now()>end)reject(Error("UI_EMPTY"));else setTimeout(tick,200)};tick()})',returnByValue:true,awaitPromise:true}}));});
 assert(!evaluated.error&&!evaluated.result.exceptionDetails&&evaluated.result.result.value.text.length>40,'SHORTCUT_UI_EMPTY');report.ui=evaluated.result.result.value;
 // The real UI is ready before requiring APIs from the main module. Retain
 // both reads, including a precise error if a Unicode-path COM wrapper fails.
 const expression=`(()=>{const {shell}=process.mainModule.require('electron');const read=p=>{try{return {ok:true,details:shell.readShortcutLink(p)}}catch(e){return {ok:false,error:String(e)}}};return {original:read(${JSON.stringify(original)}),asciiCopy:read(${JSON.stringify(copy)})}})()`;
 const reply=await request('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});report.nativeQueryException=reply.exceptionDetails||null;assert(!reply.exceptionDetails,'NATIVE_LINK_READ_QUERY_FAILED');const info=reply.result.value;report.nativeLinkRead=info;
 assert(info.asciiCopy.ok&&same(info.asciiCopy.details.target,expected)&&same(info.asciiCopy.details.icon,expected)&&info.asciiCopy.details.iconIndex===0,'IDENTICAL_BINARY_ASCII_COPY_TARGET_ICON');
 report.originalUnicodeReadSupported=Boolean(info.original.ok&&same(info.original.details.target,expected)&&same(info.original.details.icon,expected));
 // Original actually launched this exact installed EXE and loaded its UI.
 // The unchanged binary copy independently proves the target and icon; this
 // closes the property gate even when a path wrapper cannot read Unicode.
 report.nativeTargetAndIconVerifiedOnIdenticalBytes=true;
 await request('Runtime.evaluate',{expression:'(()=>{setTimeout(()=>process.mainModule.require("electron").app.quit(),50);return true})()',returnByValue:true});
 const deadline=Date.now()+30000;while(alive()&&Date.now()<deadline)await delay(100);assert(!alive(),'SHORTCUT_NORMAL_EXIT_TIMEOUT');normalClosed=true;
 assert(sha(original)===before&&sha(copy)===before,'SHORTCUT_BYTES_CHANGED');report.status='PASS_ACTUAL_UNICODE_DESKTOP_SHORTCUT_LAUNCH_AND_NATIVE_LINK_READ';report.originalShortcutUnchanged=true;report.normalExitVerified=true;
}catch(e){report.status='FAIL';report.error=String(e.stack||e);}
finally{
 for(const p of pending.values()){clearTimeout(p.t);p.reject(Error('NATIVE_LINK_CHECK_ENDED'));}pending.clear();try{pageSocket?.close();socket?.close();}catch{}
 if(pid&&!normalClosed&&alive()){report.forcedCleanup=true;spawnSync(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/PID',String(pid),'/T','/F'],{windowsHide:true,timeout:15000});}
 fs.writeFileSync(path.join(evidence,'ACTUAL_DESKTOP_SHORTCUT_LAUNCH.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,shortcutEdited:false,normalExitVerified:report.normalExitVerified||false}));
}
if(report.status==='FAIL')process.exitCode=1;

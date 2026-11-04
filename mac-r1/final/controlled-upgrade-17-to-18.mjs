import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{execFileSync,spawnSync}from'node:child_process';import{launch,delay}from'./controlled-cdp.mjs';
if(process.argv[2]==='--plan'){console.log(JSON.stringify({status:'PREPARED_NOT_EXECUTED',controlledTransportRoute:true,formalUrlServingTested:false}));process.exit(0);}
const[app,fixture,out,targetSha]=process.argv.slice(2);const report={status:'RUNNING',memberDataUsed:false,controlledQaClient:true,controlledTransportRoute:true,formalUrlServingTested:false,transportOnlyOverride:true,baseline:'unchanged released17 package',feed:'real embedded trust/signatures and formal target URLs; metadata and target requests routed through same-host QA nonce before main execution',productionTrustRootUnchanged:true,systemInstallerConsentAutomated:false};let c,profile;
const snapshot='('+async function(){
 if(!(await indexedDB.databases()).some(d=>d.name==='omc-photo-select'))return null;
 const db=await new Promise((y,n)=>{const r=indexedDB.open('omc-photo-select');r.onsuccess=()=>y(r.result);r.onerror=()=>n(r.error);r.onupgradeneeded=()=>{r.transaction.abort();n(Error('Unexpected new database'));};});
 const tx=db.transaction(['projects','photoAssets','decisions'],'readonly');const read=n=>new Promise((y,x)=>{const r=tx.objectStore(n).getAll();r.onsuccess=()=>y(r.result);r.onerror=()=>x(r.error);});
 const [projects,photos,decisions]=await Promise.all(['projects','photoAssets','decisions'].map(read));db.close();
 return{projects:projects.map(p=>({id:p.id,name:p.name})),photos:photos.map(p=>({id:p.id,projectId:p.projectId,fileName:p.fileName,jpegEdit:p.jpegEdit??null,crop:p.crop??null})),decisions:decisions.map(d=>({id:d.id,photoId:d.photoId,decision:d.decision}))};
}.toString()+')()';
function rows(){return execFileSync('/bin/ps',['-axo','pid=,ppid=,lstart=,comm='],{encoding:'utf8'}).trim().split('\n').map(l=>{const p=l.trim().split(/\s+/);return{pid:Number(p[0]),ppid:Number(p[1]),identity:p.slice(2).join(' ')};});}
async function shot(name){const v=await c.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(path.dirname(out),name+'.png'),Buffer.from(v.data,'base64'));}
async function firstStart(){
 const fresh=!profile;c=await launch(app,profile);profile=c.profile;report.preMainControlledRouteInstalled=true;
 if(fresh){
  await c.until('[...document.querySelectorAll("button")].some(b=>b.getBoundingClientRect().width>0&&b.innerText.trim()==="使用此编号开始选片")',45000);
  await c.click('使用此编号开始选片');await c.until('document.querySelector("button[aria-label=跳过新手引导]")?.getBoundingClientRect().width>0',45000);await c.click('跳过新手引导');
 }
 await c.until('(()=>{const b=document.querySelector("button[aria-label=导入照片]"),s=document.querySelector(".startup-splash");return b?.getBoundingClientRect().width>0&&!b.disabled&&(!s||s.getBoundingClientRect().width===0);})()',60000);
}
try{
 await firstStart();report.originalAsar17SHA256=await import('node:crypto').then(({createHash})=>createHash('sha256').update(fs.readFileSync(path.join(app,'Contents/Resources/app.asar'))).digest('hex'));assert.equal(execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim(),'1.0.21-preview.17');await c.click('导入照片');
 await c.evaluate('(()=>{const e=document.createElement("input");e.type="file";e.id="omc-update-qa-fixture";document.body.append(e);})()');
 const doc=await c.call('DOM.getDocument'),node=await c.call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#omc-update-qa-fixture'});await c.call('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[fixture]});
 await c.evaluate('(()=>{const e=document.getElementById("omc-update-qa-fixture"),d=new DataTransfer();for(const f of e.files)d.items.add(f);document.querySelector(".drop-zone").dispatchEvent(new DragEvent("drop",{dataTransfer:d,bubbles:true,cancelable:true}));e.remove();})()');
 let before;
 const importDeadline=Date.now()+180000;while(Date.now()<importDeadline){before=await c.evaluate(snapshot);if(before?.photos.length===1)break;await delay(300);}assert.equal(before?.photos.length,1);
 await c.until('!document.querySelector(".import-dialog")',120000);
 await c.evaluate('('+function(){const p=document.querySelector('button[aria-label^="选择照片 "]');if(p)p.click();}.toString()+')()');
 await c.until('[...document.querySelectorAll("button")].some(b=>b.getBoundingClientRect().width>0&&/^保留\\s*(Enter)?$/.test(b.innerText.trim())&&!b.disabled)',45000);
 await c.evaluate('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.getBoundingClientRect().width>0&&/^保留\\s*(Enter)?$/.test(b.innerText.trim()));b.click();b.blur();})()');
 const decisionDeadline=Date.now()+30000;while(Date.now()<decisionDeadline){before=await c.evaluate(snapshot);if(before.decisions.some(d=>d.decision==='keep'))break;await delay(200);}assert(before.decisions.some(d=>d.decision==='keep'));report.before=before;
 // Wait until any auto-started analysis is settled before asking to update.
 await c.until('!document.querySelector(".workspace-status-strip--analysis")',180000);
 const qaDeadline=Date.now()+15*60000;let status;
 while(Date.now()<qaDeadline){status=await c.evaluate('window.electronAPI.checkForUpdates()');if(status.state==='available')break;await delay(15000);}
 assert.equal(status.state,'available');assert.equal(status.candidate.version,'1.0.21-preview.18');assert.equal(status.candidate.sha256,targetSha);report.initialRouteEvidence=await c.mainEvaluateOnce('({...globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__})');assert(report.initialRouteEvidence.metadataRequestsRouted>0&&report.initialRouteEvidence.targetRequestsRouted>0&&report.initialRouteEvidence.unexpectedActualRedirects===0);
 await c.click('检查更新');await c.until('document.querySelector(".update-release-notes")?.innerText.includes("Mac")',45000);await shot('update-notes-before-confirm');
 report.releaseNotesShown=true;report.payloadSha256=targetSha;
 const beforeProcesses=rows(),owned=new Set([c.child.pid]);for(let i=0;i<12;i++)for(const r of beforeProcesses)if(owned.has(r.ppid))owned.add(r.pid);
 const tracked=beforeProcesses.filter(r=>owned.has(r.pid));const exited=new Promise(resolve=>c.child.once('close',(code,signal)=>resolve({code,signal})));
 await c.click('下载并安装');
 const downloadDeadline=Date.now()+65*60000;let last=0;
 while(Date.now()<downloadDeadline&&c.child.exitCode===null){
  try{const s=await c.evaluate('window.electronAPI.getUpdateStatus()');
   if(s.state==='error'||s.reasonCode==='UPDATE_APP_BUSY'||(s.state==='downloaded'&&s.reasonCode!=='UPDATE_DOWNLOAD_VERIFIED'))throw Error('UPDATE_FLOW_FAILED:'+s.reasonCode);if(!report.packageRouteEvidence){const obs=await c.mainEvaluateOnce('({...globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__})');if(obs.packageRequestsRouted>0&&obs.packageSha256Routed===targetSha)report.packageRouteEvidence=obs;}
   if(Date.now()-last>60000){console.log(JSON.stringify({phase:'actual-signed-qa-download',state:s.state,received:s.progress?.receivedBytes,total:s.progress?.totalBytes}));last=Date.now();}
  }catch(e){if(c.child.exitCode!==null)break;if(/UPDATE_FLOW_FAILED/.test(e.message))throw e;}
  await delay(1000);
 }
 assert(report.packageRouteEvidence?.packageRequestsRouted>0&&report.packageRouteEvidence.packageSha256Routed===targetSha&&report.packageRouteEvidence.unexpectedActualRedirects===0,'QA_PACKAGE_ROUTE_NOT_PROVEN');assert.notEqual(c.child.exitCode,null,'Update did not exit the old app');report.oldExit=await exited;assert.equal(report.oldExit.code,0);
 let remaining;const settle=Date.now()+15000;do{remaining=tracked.filter(p=>rows().some(q=>q.pid===p.pid&&q.identity===p.identity));if(!remaining.length)break;await delay(200);}while(Date.now()<settle);assert.equal(remaining.length,0);report.oldOwnedProcessesSettled=true;
 const installerDeadline=Date.now()+15000;let installer;
 do{installer=spawnSync('/usr/bin/pgrep',['-f','/Installer.app/Contents/MacOS/Installer'],{encoding:'utf8'});if(installer.status===0)break;await delay(250);}while(Date.now()<installerDeadline);
 assert.equal(installer.status,0,'System Installer was not actually opened');report.systemInstallerActuallyOpened=true;
 execFileSync('/usr/sbin/screencapture',['-x',path.join(path.dirname(out),'system-installer-open.png')]);
 const oldClose=await c.close();assert.equal(oldClose.code,0);assert.equal(await import('node:crypto').then(({createHash})=>createHash('sha256').update(fs.readFileSync(path.join(app,'Contents/Resources/app.asar'))).digest('hex')),report.originalAsar17SHA256);const rootMatch=oldClose.log.match(/\[App\] userData = ([^\r\n]+)/);assert(rootMatch,'Actual userData path was not logged');c=null;
 const downloads=path.join(rootMatch[1].trim(),'update-client/downloads');const files=fs.readdirSync(downloads).filter(n=>n.endsWith('.pkg'));assert.equal(files.length,1);const pkg=path.join(downloads,files[0]);
 const crypto=await import('node:crypto');const hash=crypto.createHash('sha256');for await(const b of fs.createReadStream(pkg))hash.update(b);assert.equal(hash.digest('hex'),targetSha);report.actualDownloadedPackageHashVerified=true;
 // The OS consent step is explicitly separate: CI verifies the real handoff,
 // then uses Apple's installer CLI for deterministic installation/readback.
 spawnSync('/usr/bin/osascript',['-e','tell application "Installer" to quit'],{timeout:15000});
 const installed=spawnSync('sudo',['/usr/sbin/installer','-pkg',pkg,'-target','/'],{encoding:'utf8',timeout:300000});fs.writeFileSync(path.join(path.dirname(out),'actual-upgrade-installer.log'),installed.stdout+installed.stderr);assert.equal(installed.status,0);report.actualPackageUpgradeInstalled=true;report.installMethod='Apple installer CLI after actual GUI handoff; GUI consent not automated';
 await firstStart();const after=await c.evaluate(snapshot);assert.deepEqual(after,before);report.after=after;report.projectAndHumanDecisionPreserved=true;await shot('new18-project-preserved');
 report.reopenedVersion=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim();assert.equal(report.reopenedVersion,'1.0.21-preview.18');
 report.close=await c.close();c=null;assert.equal(report.close.code,0);assert.equal(report.close.descendantsSettled,true);report.status='PASS_ACTUAL_SIGNED_DOWNLOAD_OS_HANDOFF_INSTALL_REOPEN_AND_PROJECT_PRESERVATION';
}catch(e){report.status='FAIL';report.error=e.stack;process.exitCode=1;}finally{if(c)try{report.failureCleanup=await c.close();}catch{}fs.writeFileSync(out,JSON.stringify(report,null,2));}

// Generic synthetic-only Windows VM acceptance. No product source or member photos here.
import fs from 'node:fs';
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
const log=fs.openSync(path.join(out,'source-app.log'),'a');
const env={...process.env};delete env.OMC_PREVIEW15_TRANSPORT_KEY;delete env.GH_TOKEN;delete env.GITHUB_TOKEN;delete env.ELECTRON_RUN_AS_NODE;
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT:'+method));},45000);pending.set(id,{resolve,reject,t});ws.send(JSON.stringify({id,method,params}));});
async function ev(expression){const r=await call('Runtime.evaluate',{expression:'(async()=>{const value=await ('+expression+');return JSON.stringify(value);})()',returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('RENDERER_EVAL:'+JSON.stringify(r.exceptionDetails).slice(0,1200));return JSON.parse(r.result.value);}
async function until(expression,ms=120000){const end=Date.now()+ms;while(Date.now()<end){if(await ev('Boolean(await ('+expression+'))'))return;await delay(200);}throw Error('WAIT:'+expression.slice(0,130));}
async function click(text){assert(await ev(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.offsetWidth&&!e.disabled&&(e.getAttribute('aria-label')===${JSON.stringify(text)}||e.innerText.trim()===${JSON.stringify(text)}));if(!e)return false;e.click();return true})()`),'BUTTON:'+text);}
async function snap(name){const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}
try{
 const expectedBranch=process.platform==='darwin'?'refs/heads/verify-jpeg19-mac':'refs/heads/verify-jpeg19-cloud';
 assert(['win32','darwin'].includes(process.platform)&&process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks'&&process.env.GITHUB_REF===expectedBranch,'CLOUD_SCOPE');
 let fixture=providedFixture,width=null,height=null;
 if(!fixture){width=8192;height=5464;const rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,c=((x>>5)^(y>>5))&1;rgba[i]=40+(x%160);rgba[i+1]=35+(y%165);rgba[i+2]=c?155:60;rgba[i+3]=255;}
  fixture=path.join(work,'synthetic-large.jpg');fs.writeFileSync(fixture,jpeg.encode({data:rgba,width,height},88).data);
 }else{report.syntheticOnly=false;report.memberDataUsed=true;}
 originalPath=fixture;const encoded=fs.readFileSync(fixture);report.original={width,height,bytes:encoded.length,sha256:hash(encoded)};
 report.stage='launch';
 vite=spawn(process.execPath,[path.join(source,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5173','--strictPort'],{cwd:source,env,stdio:['ignore',log,log],detached:process.platform==='darwin'});
 let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch('http://127.0.0.1:5173')).ok;if(ready)break;}catch{}await delay(200);}assert(ready,'VITE_START');
 const profile=path.join(work,'profile');
 const executable=process.platform==='darwin'?'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron':'node_modules/electron/dist/electron.exe';
 app=spawn(path.join(source,executable),[source,'--user-data-dir='+profile,'--remote-debugging-port=0','--no-first-run'],{cwd:source,env,stdio:['ignore',log,log],detached:process.platform==='darwin'});
 let target;for(let i=0;i<200;i++){try{const port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);const rows=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();target=rows.find(x=>x.type==='page'&&x.url.startsWith('http://localhost:5173'));if(target)break;}catch{}await delay(250);}assert(target,'NORMAL_SOURCE_MAIN_NOT_FOUND');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await until('document.querySelector("#root")?.innerText.length>40');
 report.stage='import';await until('[...document.querySelectorAll("button")].some(e=>e.offsetWidth&&e.innerText.trim()==="使用此编号开始选片")',45000);await click('使用此编号开始选片');
 if(await ev('Boolean(document.querySelector("button[aria-label=跳过新手引导]"))'))await click('跳过新手引导');
 await until('[...document.querySelectorAll("button")].some(e=>e.offsetWidth&&e.getAttribute("aria-label")==="导入照片")');await click('导入照片');
 await call('DOM.enable');const doc=await call('DOM.getDocument');const input=await call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file]'});assert(input.nodeId,'REAL_FILE_INPUT');await call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[fixture]});await until('document.querySelectorAll(".photo-tile").length===1');
 if(await ev('Boolean(document.querySelector("button[aria-label=跳过新手引导]"))'))await click('跳过新手引导');
 await ev('(()=>{document.querySelector(".photo-tile").click();return true})()');await click('单图');await until('Boolean(document.querySelector(".single-photo-view"))');await snap('imported');
 report.stage='open_adjustment';await until('[...document.querySelectorAll("button")].some(e=>e.offsetWidth&&!e.disabled&&e.innerText.includes("JPEG 基础调整"))');
 await ev('(()=>{[...document.querySelectorAll("button")].find(e=>e.offsetWidth&&!e.disabled&&e.innerText.includes("JPEG 基础调整")).click();return true})()');
 await until('document.querySelector(".exposure-dialog")?.dataset.previewQuality==="refined"',240000);
 await until('document.querySelector(".single-photo-view .highres-viewer[data-adjustment-preview=effect] img")?.complete');
 const pixelsExpression='(()=>{const i=document.querySelector(".single-photo-view .highres-viewer[data-adjustment-preview=effect] img"),c=document.createElement("canvas");if(!i||!i.complete||!i.naturalWidth)throw Error("DISPLAY_IMAGE_NOT_READY");c.width=64;c.height=64;const x=c.getContext("2d");x.drawImage(i,0,0,64,64);const d=x.getImageData(0,0,64,64).data;let sum=0,h=2166136261;for(let k=0;k<d.length;k++)if(k%4!==3){sum+=d[k];h=Math.imul(h^d[k],16777619)}return {mean:sum/(64*64*3),fingerprint:(h>>>0).toString(16),width:i.naturalWidth,height:i.naturalHeight}})()';
 report.initial=await ev('(()=>{const s=document.querySelector(".exposure-dialog");return {quality:s.dataset.previewQuality,images:[...document.querySelectorAll(".single-photo-view .highres-viewer[data-adjustment-preview=effect] img")].map(i=>({width:i.naturalWidth,height:i.naturalHeight,complete:i.complete})),alerts:[...s.querySelectorAll("[role=alert]")].map(e=>e.innerText)}})()');report.initial.pixels=await ev(pixelsExpression);assert(!report.initial.alerts.length,'INITIAL_PREVIEW_ERROR');assert(report.initial.images.some(i=>i.width>0),'INITIAL_PREVIEW_EMPTY');await snap('initial-refined');
 report.stage='drag';
 const bounds=await ev(`(()=>{const e=document.querySelector('input[type="range"][aria-label="曝光 EV"]');e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,min:Number(e.min),max:Number(e.max)}})()`);
 await ev('(()=>{window.__omcCloudFrames=[];const s=document.querySelector(".exposure-dialog");window.__omcCloudObserver=new MutationObserver(()=>{if(window.__omcCloudFrames.length<2000)window.__omcCloudFrames.push({at:performance.now(),quality:s.dataset.previewQuality,feedback:s.dataset.previewFeedbackMs,images:[...document.querySelectorAll(".single-photo-view .highres-viewer[data-adjustment-preview=effect] img")].map(i=>i.currentSrc.slice(-100))})});window.__omcCloudObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:["src","data-preview-feedback-ms","data-preview-quality"]});return true})()');
 const y=bounds.y+bounds.height/2,x0=bounds.x+bounds.width*.55,x1=bounds.x+bounds.width*.7;
 await call('Input.dispatchMouseEvent',{type:'mousePressed',x:x0,y,button:'left',buttons:1,clickCount:1});
 for(let i=0;i<60;i++){await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:x0+(x1-x0)*i/59,y,button:'left',buttons:1});await delay(70);}
 report.frames=await ev('window.__omcCloudFrames');
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:x1,y,button:'left',buttons:0,clickCount:1});
 report.interactiveCommits=report.frames.filter(f=>f.quality==='interactive').length;assert(report.interactiveCommits>0,'NO_INTERMEDIATE_FEEDBACK_DURING_DRAG');
 report.stage='refined_after_drag';await until('document.querySelector(".exposure-dialog")?.dataset.previewQuality==="refined"&&[...document.querySelectorAll(".exposure-dialog button")].some(e=>e.getAttribute("aria-label")?.startsWith("保存")&&!e.disabled)',240000);
 await until('document.querySelector(".single-photo-view .highres-viewer[data-adjustment-preview=effect] img")?.complete');
 await ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
 report.after=await ev(`(()=>{const s=document.querySelector(".exposure-dialog");return {quality:s.dataset.previewQuality,value:document.querySelector('input[type="range"][aria-label="曝光 EV"]').value,images:[...document.querySelectorAll(".single-photo-view .highres-viewer[data-adjustment-preview=effect] img")].map(i=>({width:i.naturalWidth,height:i.naturalHeight,complete:i.complete})),alerts:[...s.querySelectorAll("[role=alert]")].map(e=>e.innerText),feedback:s.dataset.previewFeedbackMs}})()`);report.after.pixels=await ev(pixelsExpression);assert(!report.after.alerts.length,'FINAL_PREVIEW_ERROR');assert(report.after.images.length>0&&report.after.images.every(i=>i.complete&&i.width>0&&Math.max(i.width,i.height)<=1800),'DISPLAY_DIMENSION_OR_DECODE');assert(report.after.pixels.fingerprint!==report.initial.pixels.fingerprint&&report.after.pixels.mean>report.initial.pixels.mean+1,'PIXELS_DID_NOT_BRIGHTEN');await snap('adjusted-refined');
 report.stage='save';await ev('(()=>{const b=[...document.querySelectorAll(".exposure-dialog button")].find(e=>e.getAttribute("aria-label")?.startsWith("保存")&&!e.disabled);if(!b)throw Error("SAVE_DISABLED");b.click();return true})()');await until('document.querySelector(".exposure-dialog")?.innerText.includes("已保存")');await snap('saved');
 report.stage='reopen';await click('返回信息');await until('!document.querySelector(".exposure-dialog")');await click('调整 JPEG 参数');await until('document.querySelector(".exposure-dialog")?.dataset.previewQuality==="refined"',240000);
 report.reopenedValue=await ev(`Number(document.querySelector('input[type="range"][aria-label="曝光 EV"]').value)`);assert(report.reopenedValue===Number(report.after.value),'SAVED_VALUE_NOT_RESTORED');await snap('reopened');
 assert(hash(fs.readFileSync(fixture))===report.original.sha256,'ORIGINAL_MODIFIED');
 report.status='PASS_SOURCE_JPEG';report.stage='done';report.limitations=['Source dev entry, not installed package',providedFixture?'Authorized real photo':'Synthetic photo','No AI runtime acceptance','CDP real controls and file input, not manual OS picker','Export and group workflow still require separate acceptance'];
}catch(e){report.status='FAIL';report.error=String(e.stack||e);try{report.dom=await ev('document.body.innerText.slice(0,14000)');await snap('failure');}catch{}}
finally{if(originalPath&&fs.existsSync(originalPath)){report.originalAfterSha256=hash(fs.readFileSync(originalPath));report.originalUnchanged=report.originalAfterSha256===report.original?.sha256;}try{ws?.close();}catch{}for(const p of [app,vite])if(p?.pid){if(process.platform==='darwin'){try{process.kill(-p.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}else{await new Promise(resolve=>{const k=spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});k.on('exit',resolve);});}}fs.writeFileSync(path.join(out,'JPEG_FUNCTIONAL.json'),JSON.stringify(report,null,2));fs.closeSync(log);}
if(report.status==='FAIL')process.exitCode=1;

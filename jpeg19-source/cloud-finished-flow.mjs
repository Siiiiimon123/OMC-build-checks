// Existing-project control patterns: jpeg-dom-final.mjs crop/group/export checks.
// Native picker answers are adapted; real import/export IPC and DB paths stay intact.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const hash=b=>createHash('sha256').update(b).digest('hex');
function check(v,m){if(!v)throw Error(m);}
export function installImportPicker(files){
 const {dialog}=process.mainModule.require('electron');
 if(!Array.isArray(files)||files.length<1||files.length>2||files.some(p=>typeof p!=='string'||!p))throw Error('IMPORT_FIXTURE_PATHS');
 dialog.showOpenDialog=async(...args)=>{const options=args.at(-1);if(options?.title!=='选择照片文件'||!options.properties?.includes('openFile')||!options.properties?.includes('multiSelections')||options.properties.includes('openDirectory'))throw Error('UNREVIEWED_IMPORT_PICKER');return{canceled:false,filePaths:[...files]};};
 return true;
}
export async function installCloudImportPicker(work,files){
 const log=fs.readFileSync(path.join(work,'evidence/source-app.log'),'utf8');
 const endpoint=[...log.matchAll(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/g)].at(-1)?.[1];check(endpoint,'IMPORT_MAIN_INSPECTOR_ENDPOINT');
 const socket=new WebSocket(endpoint);let timer;
 try{
  await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('IMPORT_MAIN_CONNECT_TIMEOUT')),10000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('IMPORT_MAIN_CONNECT'));},{once:true});});
  return await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('IMPORT_MAIN_EVALUATION_TIMEOUT')),10000);socket.addEventListener('message',event=>{const reply=JSON.parse(event.data);if(reply.id!==1)return;clearTimeout(timer);if(reply.error||reply.result?.exceptionDetails)reject(Error('IMPORT_MAIN_EVALUATION'));else resolve(reply.result?.result?.value);});socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'('+installImportPicker.toString()+')('+JSON.stringify(files)+')',returnByValue:true,awaitPromise:true}}));});
 }finally{clearTimeout(timer);socket.close();}
}
export function installExportPicker(output){
 const {dialog}=process.mainModule.require('electron');
 dialog.showOpenDialog=async(...args)=>{const options=args.at(-1);if(options?.title!=='选择导出位置'||!options.properties?.includes('openDirectory'))throw Error('UNREVIEWED_PICKER');return{canceled:false,filePaths:[output]};};
 return true;
}
export async function runFinishedFlow({source,work,call,ev,until,click,snap,fixtures,restartApp}){
 check(process.env.GITHUB_ACTIONS==='true'&&['win32','darwin'].includes(process.platform),'CLOUD_DESKTOP_ONLY');
 const result={status:'RUNNING',nativeFolderPickerAdapter:true,osPickerManuallyTested:false,dbOrProjectFabrication:false,edits:{}};
 const progress=stage=>{result.stage=stage;fs.writeFileSync(path.join(work,'evidence/FINISHED_PROGRESS.json'),JSON.stringify({stage,at:new Date().toISOString()}));console.log(JSON.stringify({finishedFlowStage:stage}));};
 const page=(fn,...args)=>ev('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const waitPage=(fn,...args)=>until('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const cropDimensions=()=>page(()=>{const m=document.querySelector('.crop-output-summary strong')?.textContent.match(/(\d+)\s*×\s*(\d+)/);if(!m)throw Error('CROP_DIMENSIONS');return{width:Number(m[1]),height:Number(m[2])};});
 const openCrop=async(group=false)=>{
  await waitPage(group=>{const scope=group?document.querySelector('.group-compare'):document;return Boolean(scope&&[...scope.querySelectorAll('button')].find(e=>e.offsetWidth&&!e.disabled&&(group?e.innerText.trim()==='裁切 JPEG':/^(裁切 JPG|调整 JPG 裁切)/.test(e.innerText.trim()))));},group);
  check(await page(group=>{const scope=group?document.querySelector('.group-compare'):document;const b=[...scope.querySelectorAll('button')].find(e=>e.offsetWidth&&!e.disabled&&(group?e.innerText.trim()==='裁切 JPEG':/^(裁切 JPG|调整 JPG 裁切)/.test(e.innerText.trim())));if(!b)return false;b.click();return true;},group),'CROP_ENTRY');
  await until('Boolean(document.querySelector(".crop-output-summary"))');
 };
 const crop=async(group=false)=>{
  await openCrop(group);await click('16:9');
  const horizontal=await cropDimensions();await click('切换横竖（O）');const vertical=await cropDimensions();check(Math.abs(horizontal.width/horizontal.height-16/9)<.003&&Math.abs(vertical.width/vertical.height-9/16)<.003,'CROP_ORIENTATION');await click('切换横竖（O）');const final=await cropDimensions();check(final.width===horizontal.width&&final.height===horizontal.height,'CROP_TOGGLE_RESTORE');await snap(group?'group-crop':'single-crop');await click('保存裁切（Enter）');await until('!document.querySelector(".crop-output-summary")');return final;
 };
 const savedPreview=async(group)=>{
  await waitPage(group=>{const scope=group?document.querySelector('.group-compare'):document;return Boolean(scope&&[...scope.querySelectorAll('button')].find(e=>e.offsetWidth&&!e.disabled&&(group?e.innerText.trim()==='调整 JPEG':e.innerText.trim()==='调整 JPEG 参数')));},group);
  await page(group=>{const scope=group?document.querySelector('.group-compare'):document;[...scope.querySelectorAll('button')].find(e=>e.offsetWidth&&!e.disabled&&(group?e.innerText.trim()==='调整 JPEG':e.innerText.trim()==='调整 JPEG 参数')).click();return true;},group);
  await until('document.querySelector(".exposure-dialog")?.dataset.previewQuality==="refined"',120000);
  const metrics=await page(async group=>{
   const i=document.querySelector(group?'.exposure-stage img':'.single-photo-view .highres-viewer[data-adjustment-preview=effect] img');if(!i)throw Error('SAVED_PREVIEW_IMAGE');await i.decode();const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');x.drawImage(i,0,0,64,64);const bytes=x.getImageData(0,0,64,64).data,d=await crypto.subtle.digest('SHA-256',bytes);
   return{ev:Number(document.querySelector('.exposure-dialog input[type=range][aria-label="曝光 EV"]').value),pixelSha256:Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,'0')).join(''),width:i.naturalWidth,height:i.naturalHeight};
  },group);
  await click(group?'关闭曝光窗口':'返回信息');return metrics;
 };
 let mainWs;const mp=new Map();let seq=0;
 const mainEval=expression=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{mp.delete(id);reject(Error('MAIN_INSPECTOR_TIMEOUT'));},10000);mp.set(id,{resolve,reject,t});mainWs.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});
 try{
  progress('single-crop');
  await click('返回信息');await until('!document.querySelector(".exposure-dialog")');
  const first=await page(()=>({name:document.querySelector('.single-filename').textContent,id:document.querySelector('.single-photo-view').dataset.reviewPhotoId}));
  result.edits[first.name]={crop:await crop()};
  await page(()=>{document.querySelector('.single-photo-view').focus();return true;});
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until('document.body.innerText.includes("保留 1")||document.body.innerText.includes("保留\\n1")');
  result.keyboard={enterSentToReviewSurface:true};
  await click('网格');await waitPage(n=>document.querySelectorAll('.photo-tile').length===n,fixtures.length);
  const grid=await page(()=>[...document.querySelectorAll('.photo-tile')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  check(grid.length===fixtures.length&&(grid.length===1||!((grid[0].x<grid[1].x+grid[1].width&&grid[0].x+grid[0].width>grid[1].x)&&(grid[0].y<grid[1].y+grid[1].height&&grid[0].y+grid[0].height>grid[1].y))),'PHOTO_GRID_OVERLAP');result.grid={noOverlap:true,rectangles:grid};await snap('photo-grid');
  if(fixtures.length>1){
  // This source-only VM has no sidecar. Preserve its failed-AI isolation and
  // test basic grouping in a real fresh process, never by clearing a registry.
  progress('fresh-process-before-basic-grouping');check(typeof restartApp==='function','RESTART_CALLBACK_REQUIRED');
  result.preGroupRestart=await restartApp();
  result.preGroupRestart.scope='Source VM has no AI runtime; fresh-process basic grouping only, not live-AI quiescence qualification';
  progress('real-basic-grouping');
  await page(async()=>{const {photoSelectionService}=await import('/src/services/photoSelectionService.js');const original=photoSelectionService.runBasicVisualGrouping;window.__omcBasicGroupingError=null;photoSelectionService.runBasicVisualGrouping=async(...args)=>{try{return await original(...args);}catch(error){window.__omcBasicGroupingError={code:String(error?.code??'UNSPECIFIED').slice(0,120),name:String(error?.name??'Error').slice(0,80)};throw error;}};return true;});
  await until('[...document.querySelectorAll(".basic-visual-grouping-panel button")].some(e=>!e.disabled&&e.innerText.trim()==="基础视觉分组，不含AI质量")');await click('基础视觉分组，不含AI质量');
  await until('Boolean(window.__omcBasicGroupingError)||/已保存|基础运行已保存/.test(document.querySelector(".basic-visual-grouping-panel")?.innerText??"")',90000);
  result.basicGroupingError=await page(()=>window.__omcBasicGroupingError);check(!result.basicGroupingError,'ACTUAL_BASIC_GROUPING_FAILED:'+result.basicGroupingError?.code);
  await click('相似组');await until('Boolean(document.querySelector(".group-compare"))');
  const selected=await page(()=>{const c=document.querySelector('.gcp-card[aria-current=true]');return c?{name:c.querySelector('img')?.alt,label:c.getAttribute('aria-label')}:null;});check(selected?.name,'REAL_GROUP_NOT_FORMED');
  progress('group-adjust-and-crop');
  await page(()=>{const e=[...document.querySelectorAll('.group-compare button')].find(e=>e.offsetWidth&&!e.disabled&&e.innerText.trim()==='调整 JPEG');if(!e)throw Error('GROUP_ADJUST_MISSING');e.click();return true;});
  await until('document.querySelector(".exposure-dialog")?.dataset.previewQuality==="refined"',120000);
  await page(()=>{const e=document.querySelector('.exposure-dialog input[aria-label="曝光 EV 数值"]');if(!e)throw Error('GROUP_NUMERIC_INPUT');e.focus();e.select();return true;});
  await call('Input.insertText',{text:'0.8'});await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await waitPage(()=>Math.abs(Number(document.querySelector('.exposure-dialog input[type=range][aria-label="曝光 EV"]')?.value)-.8)<.01&&document.querySelector('.exposure-dialog')?.dataset.previewQuality==='refined'&&[...document.querySelectorAll('.exposure-dialog button')].some(e=>e.getAttribute('aria-label')?.startsWith('保存')&&!e.disabled));
  await page(()=>{[...document.querySelectorAll('.exposure-dialog button')].find(e=>e.getAttribute('aria-label')?.startsWith('保存')&&!e.disabled).click();return true;});await until('document.querySelector(".exposure-dialog")?.innerText.includes("已保存")&&[...document.querySelectorAll(".exposure-dialog button")].some(e=>e.getAttribute("aria-label")==="关闭曝光窗口"&&!e.disabled)');await snap('group-adjusted');await click('关闭曝光窗口');
  const gcrop=await crop(true);result.edits[selected.name]={crop:gcrop};
  check(await page(label=>document.querySelector('.gcp-card[aria-current=true]')?.getAttribute('aria-label')===label,selected.label),'GROUP_SELECTION_CHANGED');result.group={realCandidateGroup:true,editedPhoto:selected.name,selectionAndDecisionPreserved:true};await snap('group-return');
  const beforeRestart=await savedPreview(true);check(Math.abs(beforeRestart.ev-.8)<.01,'GROUP_SAVE_NOT_PERSISTED');check(typeof restartApp==='function','RESTART_CALLBACK_REQUIRED');progress('application-restart-group');result.restart=await restartApp();
  await click('相似组');await until('Boolean(document.querySelector(".gcp-card[aria-current=true]"))');check(await page(label=>document.querySelector('.gcp-card[aria-current=true]')?.getAttribute('aria-label')===label,selected.label),'RESTART_GROUP_CHECKPOINT');
  const afterRestart=await savedPreview(true);check(beforeRestart.ev===afterRestart.ev&&beforeRestart.pixelSha256===afterRestart.pixelSha256,'RESTART_SAVED_PREVIEW_MISMATCH');await openCrop(true);const restored=await cropDimensions();check(restored.width===gcrop.width&&restored.height===gcrop.height,'RESTART_CROP_LOST');await click('取消（Esc）');result.restart.savedPreview={before:beforeRestart,after:afterRestart};result.restart.cropRestored=true;result.restart.groupOpenedExplicitly=true;await snap('group-reopened-after-app-restart');
  // Keep the group-edited photo through the real control, then export current keep set.
  await page(()=>{const b=document.querySelector('.gcp-detail-actions .keep');if(!b||b.disabled)throw Error('GROUP_KEEP_UNAVAILABLE');b.click();return true;});
  }else{
   progress('application-restart-real-photo');
   result.group={tested:false,reason:'Single real-photo project; group flow uses independent synthetic pair'};
   await click('单图');const beforeRestart=await savedPreview(false);check(typeof restartApp==='function','RESTART_CALLBACK_REQUIRED');result.restart=await restartApp();await click('单图');await until('Boolean(document.querySelector(".single-photo-view"))');const afterRestart=await savedPreview(false);check(beforeRestart.ev===afterRestart.ev&&beforeRestart.pixelSha256===afterRestart.pixelSha256,'RESTART_SAVED_PREVIEW_MISMATCH');await openCrop(false);const restored=await cropDimensions(),expected=result.edits[first.name].crop;check(restored.width===expected.width&&restored.height===expected.height,'RESTART_CROP_LOST');await click('取消（Esc）');result.restart.savedPreview={before:beforeRestart,after:afterRestart};result.restart.cropRestored=true;await snap('single-reopened-after-app-restart');
  }
  const output=path.join(work,'finished-export');fs.mkdirSync(output);
  progress('native-picker-adapter-and-formats');
  const log=fs.readFileSync(path.join(work,'evidence/source-app.log'),'utf8');const endpoint=[...log.matchAll(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/g)].at(-1)?.[1];check(endpoint,'MAIN_INSPECTOR_ENDPOINT');
  mainWs=new WebSocket(endpoint);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('MAIN_INSPECTOR_CONNECT')),5000);mainWs.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});mainWs.addEventListener('error',e=>{clearTimeout(t);reject(e);},{once:true});});mainWs.addEventListener('message',e=>{const m=JSON.parse(e.data),p=mp.get(m.id);if(p){clearTimeout(p.t);mp.delete(m.id);m.error?p.reject(Error('MAIN_PROTOCOL')):m.result?.exceptionDetails?p.reject(Error('MAIN_EVALUATION:'+String(m.result.exceptionDetails.exception?.description??m.result.exceptionDetails.text).slice(0,1000))):p.resolve(m.result?.result?.value);}});
  const picker=await mainEval('('+installExportPicker.toString()+')('+JSON.stringify(output)+')');check(picker,'PICKER_ADAPTER');
  await waitPage(()=>[...document.querySelectorAll('button')].some(e=>e.offsetWidth&&!e.disabled&&e.getAttribute('aria-label')==='导出选片'));await click('导出选片');await until('Boolean(document.querySelector("input[name=export-file-format][value=raw]"))');
  await page(()=>{document.querySelector('input[name=export-file-format][value=raw]').click();return true;});
  await waitPage(()=>document.querySelector('input[name=export-file-format][value=raw]')?.checked&&[...document.querySelectorAll('.export-dialog .dialog-actions button')].some(e=>e.classList.contains('primary-button')&&e.disabled));result.rawOnlyWithoutRawDisabled=true;
  await page(()=>{document.querySelector('input[name=export-file-format][value=jpeg]').click();document.querySelector('input[name=export-output-mode][value=folder]').click();return true;});
  await page(()=>{const b=[...document.querySelectorAll('.export-dialog .dialog-actions button')].find(e=>e.classList.contains('primary-button'));if(!b||b.disabled)throw Error('EXPORT_DISABLED');b.click();return true;});
  progress('finished-jpeg-export');
  await until('Boolean(document.querySelector(".export-result"))',180000);await snap('export-result');check(!await page(()=>Boolean(document.querySelector('.export-failures'))),'EXPORT_FAILED');
  const files=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);check(!e.isSymbolicLink(),'EXPORT_SYMLINK');if(e.isDirectory())walk(p);else files.push(p);}}walk(output);
  const require=createRequire(path.join(source,'package.json')),jpeg=require('jpeg-js');result.exported=[];
  progress('independent-jpeg-byte-check');
  for(const file of files){if(!/\.jpe?g$/i.test(file)){check(['OMC-EXPORT-STATUS.txt','OMC-EXPORT-STARTED.txt'].includes(path.basename(file)),'UNEXPECTED_EXPORT_MEMBER');continue;}
   const bytes=fs.readFileSync(file);check(!fixtures.some(f=>f.sha256===hash(bytes)),'ORIGINAL_JPEG_EXPORTED');const decoded=jpeg.decode(bytes,{useTArray:true,maxMemoryUsageInMB:1024});
   const input=fixtures.find(f=>path.basename(file).toLowerCase().includes(path.parse(f.path).name.toLowerCase()));check(input,'EXPORTED_SOURCE_MAPPING');const expected=result.edits[path.basename(input.path)]?.crop;check(expected&&expected.width===decoded.width&&expected.height===decoded.height&&Math.max(decoded.width,decoded.height)>1800,'FINISHED_JPEG_DIMENSIONS');
   result.exported.push({relativePath:path.relative(output,file),bytes:bytes.length,sha256:hash(bytes),width:decoded.width,height:decoded.height});
  }
  const statusFile=files.find(file=>path.basename(file)==='OMC-EXPORT-STATUS.txt');check(statusFile&&/^状态：完整$/m.test(fs.readFileSync(statusFile,'utf8')),'PERSISTENT_EXPORT_NOT_COMPLETE');result.persistentExportStatusVerified=true;
  check(result.exported.length>=1&&result.exported.length<=fixtures.length,'FINISHED_JPEG_COUNT');result.originalsUnchanged=fixtures.every(f=>hash(fs.readFileSync(f.path))===f.sha256);check(result.originalsUnchanged,'ORIGINAL_CHANGED');result.status=fixtures.length>1?'PASS_SOURCE_FINISHED_JPEG_GROUP_AND_EXPORT':'PASS_SOURCE_FINISHED_JPEG_EXPORT';progress('done');return result;
 }catch(e){result.status='FAIL';result.error=String(e.stack||e);throw e;}
 finally{for(const p of mp.values()){clearTimeout(p.t);p.reject(Error('FLOW_FINISHED'));}mp.clear();try{mainWs?.close();}catch{}fs.writeFileSync(path.join(work,'evidence/FINISHED_FLOW.json'),JSON.stringify(result,null,2));}
}

// Cloud-only synthetic SVG display capability. No photos, model or database fixture.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const [source,work]=process.argv.slice(2),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(ok,message)=>{if(!ok)throw Error(message);};
check(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks'
 &&process.env.GITHUB_REF==='refs/heads/verify-optimization20'&&['win32','darwin'].includes(process.platform),'CLOUD_SCOPE');
const evidence=path.join(work,'evidence');fs.mkdirSync(evidence,{recursive:true});
const report={schema:'omc-saturation-svg-display-probe-v1',status:'RUNNING',platform:process.platform,
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
 let pageReady=false;for(let n=0;n<160;n++){
  try{pageReady=await evaluate('location.origin==="http://localhost:5173"&&document.readyState!=="loading"&&document.querySelector("#root")?.textContent.length>40');if(pageReady)break;}catch{}
  await sleep(100);
 }
 check(pageReady,'NORMAL_SOURCE_DOCUMENT_NOT_READY');
 async function probeSaturationSvg(){
  const {createJpegSaturationKernel,applyJpegSaturationRgbaRange}=await import('/src/services/jpegSaturation.js');
  const results=[];
  async function batch(width,height,fullRgb,recipes){
   const pixels=new Uint8ClampedArray(width*height*4);
   for(let n=0;n<width*height;n++){
    const p=n*4;
    if(fullRgb){pixels[p]=n>>>16;pixels[p+1]=(n>>>8)&255;pixels[p+2]=n&255;}
    else{const x=n%width,y=Math.floor(n/width);pixels[p]=y;pixels[p+1]=x;pixels[p+2]=(n*73+y*37)&255;
     if(y===0)pixels[p]=pixels[p+1]=pixels[p+2]=x;
     if(y>=1&&y<=3){pixels[p]=y===1?x:0;pixels[p+1]=y===2?x:0;pixels[p+2]=y===3?x:0;}}
    pixels[p+3]=255;
   }
   const input=document.createElement('canvas');input.width=width;input.height=height;
   input.getContext('2d',{colorSpace:'srgb'}).putImageData(new ImageData(pixels,width,height,{colorSpace:'srgb'}),0,0);
   const encoded=input.toDataURL('image/png');
   try{for(const [ev,saturation] of recipes){
    const reference=pixels.slice();applyJpegSaturationRgbaRange(reference,createJpegSaturationKernel(ev,saturation));
    const s=saturation,w=[.2126,.7152,.0722],matrix=[];
    for(let row=0;row<3;row++){for(let col=0;col<3;col++)matrix.push((row===col?s:0)+(1-s)*w[col]);matrix.push(0,0);}matrix.push(0,0,0,1,0);
    const gain=2**ev;
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><defs><filter id="f" x="0" y="0" width="100%" height="100%" color-interpolation-filters="linearRGB"><feComponentTransfer result="exposed"><feFuncR type="linear" slope="'+gain+'"/><feFuncG type="linear" slope="'+gain+'"/><feFuncB type="linear" slope="'+gain+'"/></feComponentTransfer><feColorMatrix in="exposed" type="matrix" values="'+matrix.join(' ')+'"/></filter></defs><image width="'+width+'" height="'+height+'" href="'+encoded+'" filter="url(#f)"/></svg>';
    const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),image=new Image(),output=document.createElement('canvas');
    output.width=width;output.height=height;
    let guard;const started=performance.now();
    try{
     image.src=url;await Promise.race([image.decode(),new Promise((_,reject)=>{guard=setTimeout(()=>reject(Error('SVG_DECODE_DEADLINE')),45000);})]);clearTimeout(guard);
     const context=output.getContext('2d',{colorSpace:'srgb'});context.drawImage(image,0,0);
     const actual=context.getImageData(0,0,width,height,{colorSpace:'srgb',pixelFormat:'rgba-unorm8'}).data;
     let maxError=0,sumError=0,overOne=0,alphaMismatch=0;
     for(let i=0;i<actual.length;i++){if(i%4===3){if(actual[i]!==255)alphaMismatch++;continue;}
      const error=Math.abs(actual[i]-reference[i]);maxError=Math.max(maxError,error);sumError+=error;if(error>1)overOne++;}
     results.push({width,height,pixels:width*height,fullRgb,ev,saturation,maxError,meanAbsoluteError:sumError/(width*height*3),channelsOverOne:overOne,alphaMismatch,elapsedMs:performance.now()-started});
    }finally{clearTimeout(guard);URL.revokeObjectURL(url);image.src='';output.width=output.height=1;}
   }}finally{input.width=input.height=1;}
  }
  await batch(256,256,false,[[0,1],[.6,1.15],[-.4,1.1],[0,.5],[2,2]]);
  const palettePassed=results.every(r=>r.maxError<=1&&r.alphaMismatch===0);
  if(palettePassed)await batch(4096,4096,true,[[.6,1.15],[-.4,1.1]]);
  return{kind:'isolated-synthetic-display-capability',results,palettePassed,
   eligibleForFurtherValidation:results.every(r=>r.maxError<=1&&r.alphaMismatch===0)&&results.filter(r=>r.fullRgb).length===2,
   productIntegrationDone:false,sourceOrRecipeChanged:false,realPhotosUsed:false};
 }
 report.environment=await evaluate('({hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory??null,visibility:document.visibilityState})');
 report.probe=await evaluate('('+probeSaturationSvg.toString()+')()');
 report.status='PASS_DISPLAY_CAPABILITY_PROBE_COMPLETED';
 report.limitations=['Isolated native browser SVG image filter, not a wired product drag path','Colour eligibility is not GUI performance acceptance','No real photos or new recipe/export semantics'];
}catch(error){report.status='FAIL';report.error=String(error.stack||error);}
finally{
 report.cleanup=[];
 for(const child of [app,vite])if(child?.pid){
  if(process.platform==='win32'){
   const killCode=await new Promise(resolve=>{const task=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});task.on('exit',resolve);task.on('error',()=>resolve('SPAWN_ERROR'));});
   const end=Date.now()+5000;while(child.exitCode===null&&child.signalCode===null&&Date.now()<end)await sleep(30);
   report.cleanup.push({pid:child.pid,taskkillExitCode:killCode});
  }
  else{for(const signal of ['SIGTERM','SIGKILL']){if(child.exitCode!==null||child.signalCode!==null)break;try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')report.cleanup.push({pid:child.pid,error:error.code});}
   const end=Date.now()+3000;while(child.exitCode===null&&child.signalCode===null&&Date.now()<end)await sleep(30);}}
  const settled=child.exitCode!==null||child.signalCode!==null;report.cleanup.push({pid:child.pid,settled,exitCode:child.exitCode,signal:child.signalCode});
  if(!settled)report.status='FAIL_OWNED_PROCESS_CLEANUP';
 }
 for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('QA_FINISHED'));}pending.clear();try{ws?.close();}catch{}
 fs.writeFileSync(path.join(evidence,'SVG_DISPLAY_PROBE.json'),JSON.stringify(report,null,2));fs.closeSync(log);
}
if(!report.status.startsWith('PASS_'))process.exitCode=1;

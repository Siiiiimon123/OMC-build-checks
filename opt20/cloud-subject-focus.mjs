// Isolated cloud diagnosis of existing face landmarks and native ROI facts.
// It never writes product decisions or treats a missing face as technical waste.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const [source,work,inputs]=process.argv.slice(2),require=createRequire(path.join(source,'package.json'));
const delay=ms=>new Promise(r=>setTimeout(r,ms)),hash=b=>createHash('sha256').update(b).digest('hex');
const check=(ok,m)=>{if(!ok)throw Error(m);};
check(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks'
 &&process.env.GITHUB_REF==='refs/heads/verify-optimization20'&&process.env.GITHUB_RUN_ATTEMPT==='1','OWNED_CLOUD_ONLY');
const evidence=path.join(work,'evidence');fs.mkdirSync(evidence,{recursive:true});
const report={schema:'omc-existing-face-native-focus-probe-v1',status:'RUNNING',platform:process.platform,
 images:'Only four previously shown anonymized overview/native crop files; no new full originals',
 newModelAdded:false,automaticRejectionTested:false,installedPackageTested:false,rows:[]};
const log=fs.openSync(path.join(evidence,'source-app.log'),'a');let app,server,ws,seq=0;const pending=new Map();
const env={...process.env};for(const k of Object.keys(env))if(/^(OMC_|GH_TOKEN|GITHUB_TOKEN|ELECTRON_RUN_AS_NODE)/.test(k))delete env[k];
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT:'+method));},120000);pending.set(id,{resolve,reject,t});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression:'(async()=>JSON.stringify(await ('+expression+')))()',returnByValue:true,awaitPromise:true});check(!r.exceptionDetails,'RENDERER_EXCEPTION:'+JSON.stringify(r.exceptionDetails??{}).slice(0,1000));return JSON.parse(r.result.value);}
try{
 const fixtures=JSON.parse(fs.readFileSync(path.join(inputs,'INPUTS.json'),'utf8'));
 check(fixtures.files.length===4&&fixtures.files.every(f=>/^(R2-04|R2-08)-(overview\.jpg|crop\.png)$/.test(f.file)),'FOUR_EXACT_FIXTURES');
 const routes=new Map();
 for(const f of fixtures.files){const p=path.join(inputs,f.file),b=fs.readFileSync(p);check(b.length===f.bytes&&hash(b)===f.sha256,'FIXTURE_IDENTITY');routes.set('/__focus-fixture/'+f.file,{path:p,type:f.file.endsWith('.png')?'image/png':'image/jpeg'});}
 const contract=JSON.parse(fs.readFileSync(path.join(source,'contracts/frontend-face-runtime-v1.json'),'utf8'));
 const assets=[];
 for(const row of contract.assets){
  const p=row.path.endsWith('.task')?path.join(work,'face_landmarker.task'):path.join(source,'node_modules/@mediapipe/tasks-vision/wasm',path.basename(row.path));
  if(row.path.endsWith('.task')){
   // Exactly the model URL and expected bytes already used by the native Mac builder.
   const response=await fetch('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',{signal:AbortSignal.timeout(90000)});
   check(response.ok,'EXISTING_FACE_MODEL_HTTP');const chunks=[];let count=0;
   for await(const chunk of response.body){count+=chunk.length;check(count<=row.sizeBytes,'FACE_MODEL_BYTE_LIMIT');chunks.push(chunk);}
   const bytes=Buffer.concat(chunks);check(count===row.sizeBytes&&hash(bytes)===row.sha256,'EXISTING_FACE_MODEL_IDENTITY');fs.writeFileSync(p,bytes,{flag:'wx'});
  }
  const bytes=fs.readFileSync(p);check(bytes.length===row.sizeBytes&&hash(bytes)===row.sha256,'LOCKED_FACE_ASSET_IDENTITY');
  routes.set('/'+row.path.slice('public/'.length),{path:p,type:p.endsWith('.wasm')?'application/wasm':p.endsWith('.js')?'text/javascript':'application/octet-stream'});
  assets.push({path:row.path,bytes:bytes.length,sha256:hash(bytes)});
 }
 report.assets=assets;
 const vite=await import(pathToFileURL(require.resolve('vite')).href),{createServer}=vite.default??vite;
 server=await createServer({root:source,logLevel:'error',server:{host:'127.0.0.1',port:5173,strictPort:true},plugins:[{name:'owned-focus-fixtures',configureServer(s){s.middlewares.use((req,res,next)=>{const p=new URL(req.url,'http://localhost').pathname,row=routes.get(p);if(!row)return next();const b=fs.readFileSync(row.path);res.setHeader('Content-Type',row.type);res.setHeader('Content-Length',b.length);res.end(b);});}}]});await server.listen();
 const profile=path.join(work,'profile'),binary=process.platform==='win32'?'node_modules/electron/dist/electron.exe':'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
 app=spawn(path.join(source,binary),[source,'--user-data-dir='+profile,'--remote-debugging-port=0','--no-first-run'],{cwd:source,env,stdio:['ignore',log,log],detached:process.platform==='darwin'});
 let target;for(let n=0;n<200;n++){try{const port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page'&&p.url.startsWith('http://localhost:5173'));if(target)break;}catch{}await delay(250);}check(target,'SOURCE_RENDERER_NOT_READY');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{const t=setTimeout(()=>j(Error('CDP_OPEN')),10000);ws.addEventListener('open',()=>{clearTimeout(t);r();},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);j(Error('CDP_OPEN'));},{once:true});});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});await call('Runtime.enable');
 for(const f of fixtures.files){
  const row=await evaluate(`(async()=>{
   const {analyzeFaces}=await import('/src/services/localFaceAI.js'),{measureNativeSubjectFocus}=await import('/src/services/subjectFocusMeasurement.js');
   const image=new Image();image.src=${JSON.stringify('/__focus-fixture/'+f.file)};await image.decode();
   const start=performance.now(),face=await analyzeFaces(image);let facts=null;
   if(${f.file.endsWith('-crop.png')}){const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0);facts=measureNativeSubjectFocus(x.getImageData(0,0,c.width,c.height).data,c.width,c.height);c.width=c.height=1;}
   return{width:image.naturalWidth,height:image.naturalHeight,elapsedMs:performance.now()-start,face,facts};
  })()`);
  check(row.face.available===true,'EXISTING_FACE_RUNTIME_UNAVAILABLE');report.rows.push({file:f.file,inputSha256:f.sha256,...row});
  fs.writeFileSync(path.join(evidence,'SUBJECT_FOCUS_PROBE.json'),JSON.stringify(report,null,2));
 }
 report.status='PASS_PROBE_EXECUTED_NOT_AUTOMATIC_REJECTION';
 report.limitations=['Source renderer and existing face model only; not a shipped installer acceptance','Overview geometry and provided native crop measured separately; no whole-original rejection claimed','Face landmarks are proposals, not proof of main subject, identity, or recoverability','Human-confirmed samples are holdout only; no learned weights trained'];
}catch(e){report.status='FAIL';report.error=String(e.stack??e);}
finally{
 if(ws?.readyState===WebSocket.OPEN){try{await Promise.race([call('Browser.close').catch(()=>null),delay(5000)]);}catch{}}
 if(app?.pid){for(let n=0;n<40&&app.exitCode===null&&app.signalCode===null;n++)await delay(100);if(app.exitCode===null&&app.signalCode===null){if(process.platform==='win32')await new Promise(resolve=>{const p=spawn('taskkill',['/PID',String(app.pid),'/T','/F'],{stdio:'ignore'});p.on('exit',resolve);p.on('error',resolve);});else{try{process.kill(-app.pid,'SIGTERM');}catch{}for(let n=0;n<30&&app.exitCode===null&&app.signalCode===null;n++)await delay(100);if(app.exitCode===null&&app.signalCode===null)try{process.kill(-app.pid,'SIGKILL');}catch{}}}}
 for(const p of pending.values()){clearTimeout(p.t);p.reject(Error('PROBE_FINISHED'));}pending.clear();try{ws?.close();}catch{}await server?.close();
 fs.writeFileSync(path.join(evidence,'SUBJECT_FOCUS_PROBE.json'),JSON.stringify(report,null,2));fs.closeSync(log);
}
if(report.status==='FAIL')process.exitCode=1;

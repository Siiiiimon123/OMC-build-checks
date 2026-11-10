// Runs against the already released binary in a disposable GitHub runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {once} = require('node:events');
const {createHash} = require('node:crypto');
const {spawn} = require('node:child_process');
const {setTimeout:delay} = require('node:timers/promises');

const [exe, work, jpegModule] = process.argv.slice(2);
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = {scope:'published-preview24 native baseline, generated fixtures',
  userPhotoUpload:false, syntheticAccuracyQualification:false, nativePickerGesture:false, checks:[]};
let child, client, ended;

async function connect(url) {
  assert.match(url, /^ws:\/\/127\.0\.0\.1:[1-9]\d*\/devtools\//);
  const ws = new WebSocket(url), pending = new Map();
  let sequence = 0;
  await Promise.race([once(ws, 'open'), delay(6000).then(() => {throw Error('CDP_CONNECT_TIMEOUT');})]);
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    clearTimeout(task.timer);
    if (message.error) task.reject(Error(message.error.message));
    else task.resolve(message.result);
  });
  return {
    call(method, params={}) {
      return new Promise((resolve,reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {pending.delete(id); reject(Error('CDP_TIMEOUT:'+method));}, 15000);
        pending.set(id,{resolve,reject,timer});
        ws.send(JSON.stringify({id,method,params}));
      });
    },
    close() {
      for (const task of pending.values()) {
        clearTimeout(task.timer);
        task.reject(Error('CDP_CLOSED'));
      }
      pending.clear();
      ws.close();
    },
  };
}

async function ev(fn, ...args) {
  const expression = '('+fn.toString()+')('+args.map(arg=>JSON.stringify(arg)).join(',')+')';
  const response = await client.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
}

async function until(fn, timeout=60000) {
  const deadline = Date.now()+timeout;
  while (Date.now()<deadline && child.exitCode===null) {
    const result = await ev(fn);
    if (result) return result;
    await delay(180);
  }
  throw Error('UI_STATE_TIMEOUT: '+fn.toString().slice(0,160));
}

async function click(label, scope='body') {
  const rect = await ev((label, scope) => {
    const button = [...document.querySelectorAll(scope+' button')].find(e =>
      !e.disabled && e.offsetWidth && (e.getAttribute('aria-label')===label || e.innerText.trim()===label));
    if (!button) return null;
    button.scrollIntoView({block:'nearest'});
    const r = button.getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2};
  },label,scope);
  assert(rect,'VISIBLE_BUTTON_REQUIRED: '+label);
  await client.call('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',buttons:1,clickCount:1});
  await client.call('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',buttons:0,clickCount:1});
}

async function snapshot() {
  return ev(async () => {
    const db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('omc-photo-select');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(['projects','photoAssets','decisions','groups'],'readonly');
      const read = name => new Promise((resolve,reject) => {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [projects,photos,decisions,groups] = await Promise.all(['projects','photoAssets','decisions','groups'].map(read));
      return {projects:projects.map(p=>({id:p.id,count:p.count,state:p.importState,analysis:p.analysisRunState})),
        photos:photos.map(p=>({id:p.id,file:p.fileName,analysis:p.analysis?.analysisLevel,
          automatic:p.automaticReview?.kind,crop:p.crop??null,edit:p.jpegEdit??null})),
        decisions:decisions.map(d=>({photoId:d.photoId,decision:d.decision})),
        groups:groups.map(g=>({id:g.id,photoIds:g.photoIds}))};
    } finally {db.close();}
  });
}

function fixtures() {
  const jpeg = require(jpegModule), directory = path.join(work,'fixtures');
  fs.mkdirSync(directory);
  const files = [];
  const width=640,height=480;
  for(let i=0;i<437;i++) {
    const blank = i>=425, pixels = Buffer.alloc(width*height*4);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const offset=(y*width+x)*4, tile=(Math.floor((x+i%8)/55)+Math.floor(y/64))%2;
      pixels[offset]=blank?0:35+((i*5+x)%110)+tile*62;
      pixels[offset+1]=blank?0:35+((i*3+y)%125);
      pixels[offset+2]=blank?0:35+((x+y+i)%150);
      pixels[offset+3]=255;
    }
    const encoded=jpeg.encode({data:pixels,width,height},90).data;
    const marker=Buffer.from([0xff,0xfe,0,4,i>>8,i&255]);
    const name=path.join(directory,'qa-'+String(i).padStart(3,'0')+'.jpg');
    fs.writeFileSync(name,Buffer.concat([encoded.subarray(0,2),marker,encoded.subarray(2)]),{flag:'wx'});
    files.push({path:name,sha256:digest(name)});
  }
  return files;
}

async function launch() {
  const profile=path.join(work,'profile'), portFile=path.join(profile,'DevToolsActivePort');
  fs.mkdirSync(profile,{recursive:true});
  if(fs.existsSync(portFile)) fs.unlinkSync(portFile);
  const env={...process.env};
  for (const key of Object.keys(env)) if (/^(NODE_|PYTHON|OMC_|VITE_|VIRTUAL_ENV|ELECTRON_RUN_AS_NODE)/i.test(key)) delete env[key];
  child=spawn(exe,['--user-data-dir='+profile,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],
    {env,stdio:'ignore',windowsHide:true});
  ended=once(child,'close');
  const end=Date.now()+60000;
  while(Date.now()<end && child.exitCode===null) {
    let target;
    try {
      const port=Number(fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0]);
      assert(Number.isInteger(port)&&port>0&&port<=65535);
      const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(2000)})).json();
      target=pages.find(p=>p.type==='page'&&p.url.startsWith('file:')&&p.url.endsWith('/dist/index.html'));
    } catch {}
    if(target) {
      client=await connect(target.webSocketDebuggerUrl);
      await until(()=>document.querySelector('#root')?.childElementCount&&window.electronAPI?.platform);
      await client.call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
      return;
    }
    await delay(180);
  }
  throw Error('PACKAGED_WINDOW_MISSING');
}

async function close() {
  const closing = client.call('Browser.close').catch(() => {});
  const outcome=await Promise.race([ended,delay(20000).then(()=>[null,'TIMEOUT'])]);
  client.close();
  await closing;
  client=null;
  assert.deepEqual(outcome,[0,null]);
}

async function stage(name,fn) {
  console.log('Stage:',name);
  const started=Date.now();
  const detail=await fn();
  report.checks.push({name,elapsedMs:Date.now()-started,detail:detail??null});
}

(async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert.equal(process.env.GITHUB_REPOSITORY,'Siiiiimon123/OMC-build-checks');
  assert.equal(process.env.GITHUB_REF,'refs/heads/verify-preview24-high-use');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
  assert(path.resolve(work).startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep));
  try {
    const files=fixtures();
    await stage('native-start',async()=>{
      await launch();
      const start=await ev(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='使用此编号开始选片'));
      if(start) await click('使用此编号开始选片');
      if(await ev(()=>Boolean(document.querySelector('button[aria-label=跳过新手引导]')?.offsetWidth))) await click('跳过新手引导');
    });
    await stage('batch-import',async()=>{
      await click('导入照片');
      await until(()=>Boolean(document.querySelector('.drop-zone')));
      await ev(()=>{const input=document.createElement('input');input.type='file';input.multiple=true;input.id='qa-native-input';document.body.append(input);});
      const doc=await client.call('DOM.getDocument');
      const node=await client.call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#qa-native-input'});
      await client.call('DOM.setFileInputFiles',{nodeId:node.nodeId,files:files.map(f=>f.path)});
      const injected=await ev(()=>{
        const input=document.querySelector('#qa-native-input'), transfer=new DataTransfer();
        for(const file of input.files) transfer.items.add(file);
        document.querySelector('.drop-zone').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
        input.remove();
        return transfer.files.length;
      });
      assert.equal(injected,files.length);
      await until(()=>!document.querySelector('.import-dialog')&&Boolean(document.querySelector('.photo-tile')),360000);
      const state=await snapshot();
      assert.equal(state.photos.length,files.length);
      assert.equal(state.projects.length,1);
      assert.equal(state.projects[0].state,'complete');
      return {photos:state.photos.length};
    });
    await stage('batch-analysis',async()=>{
      const start=Date.now();
      let state;
      do {
        state=await snapshot();
        const analyzed=state.photos.filter(p=>p.analysis==='full_ai').length;
        if(analyzed===files.length && state.projects[0].analysis!=='running')
          return {analyzed,groups:state.groups.length,automatic:state.photos.filter(p=>p.automatic).length};
        if(['partial','failed','interrupted','cancelled'].includes(state.projects[0].analysis))
          throw Error('BATCH_ANALYSIS_INCOMPLETE: '+state.projects[0].analysis+' full='+analyzed);
        await delay(1200);
      } while(Date.now()-start<720000);
      throw Error('BATCH_ANALYSIS_TIMEOUT: '+state.photos.filter(p=>p.analysis==='full_ai').length);
    });
    await stage('manual-review',async()=>{
      await click('单图','.view-switcher');
      await until(()=>Boolean(document.querySelector('.single-photo-view img')));
      const keep=await ev(()=>[...document.querySelectorAll('button')].find(b=>b.offsetWidth&&!b.disabled&&/^保留\s*Enter$/.test(b.innerText.trim()))?.innerText.trim());
      assert(keep);
      await click(keep);
      let after;
      const end=Date.now()+10000;
      do {
        after=await snapshot();
        if(after.decisions.some(d=>d.decision==='keep')) break;
        await delay(100);
      } while(Date.now()<end);
      assert(after.decisions.some(d=>d.decision==='keep'));
      return {humanKept:after.decisions.filter(d=>d.decision==='keep').length};
    });
    await stage('close-and-reopen',async()=>{
      const before=await snapshot();
      await close();
      await launch();
      await until(()=>Boolean(document.querySelector('.photo-tile')));
      const after=await snapshot();
      assert.deepEqual(after,before);
      return {photos:after.photos.length,decisions:after.decisions.length};
    });
    await close();
    assert(files.every(file=>digest(file.path)===file.sha256),'FIXTURE_BYTES_CHANGED');
    report.status='PASS_SCOPED_NATIVE_BASELINE';
  } catch(error) {
    report.status='FAIL';
    report.error=String(error.stack??error).slice(0,4000);
    process.exitCode=1;
  } finally {
    if(client) client.close();
    if(child?.exitCode===null) child.kill();
    fs.writeFileSync(path.join(work,'BASELINE.json'),JSON.stringify(report,null,2));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

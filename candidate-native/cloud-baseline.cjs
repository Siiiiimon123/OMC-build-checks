// Runs against a verified installed binary in a disposable GitHub runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {once} = require('node:events');
const {createHash} = require('node:crypto');
const {spawn} = require('node:child_process');
const {setTimeout:delay} = require('node:timers/promises');

const [exe, work, jpegModule, editorBinding] = process.argv.slice(2);
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fixtureSetDigest = files => createHash('sha256').update(JSON.stringify(files.map(file=>[path.basename(file.path),file.sha256]))).digest('hex');
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

async function until(fn, timeout=60000, ...args) {
  const deadline = Date.now()+timeout;
  while (Date.now()<deadline && child.exitCode===null) {
    const result = await ev(fn, ...args);
    if (result) return result;
    await delay(180);
  }
  throw Error('UI_STATE_TIMEOUT: '+fn.toString().slice(0,160));
}

async function click(label, scope='body') {
  return clickControl(label,scope+' button');
}

async function clickControl(label, selector='button') {
  let rect;
  try {
    rect = await until((label, selector) => {
      for (const button of document.querySelectorAll(selector)) {
        if (button.disabled || !button.offsetWidth ||
            (label!==null && button.getAttribute('aria-label')!==label && button.innerText.trim()!==label)) continue;
        button.scrollIntoView({block:'nearest'});
        const box = button.getBoundingClientRect();
        const point = {x:box.x+box.width/2,y:box.y+box.height/2};
        if (button.contains(document.elementFromPoint(point.x,point.y))) return point;
      }
      return null;
    },15000,label,selector);
  } catch (error) {
    throw Error('INTERACTIVE_BUTTON_REQUIRED: '+label,{cause:error});
  }
  await client.call('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',buttons:1,clickCount:1});
  await client.call('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',buttons:0,clickCount:1});
}

function verifyEditorBinding(executable, binding) {
  if (binding===undefined) return null;
  const expected=/^--(?:editor-check|upgrade-seed|upgrade-verify)=([a-f0-9]{64})$/.exec(binding)?.[1];
  assert(expected,'Expected a native test mode with a frozen installed ASAR SHA-256');
  assert(['win32','darwin'].includes(process.platform),'Native desktop platform required');
  const resources=process.platform==='win32'?'resources':'../Resources';
  const installedSha=digest(path.resolve(path.dirname(executable),resources,'app.asar'));
  assert.equal(installedSha,expected,'EDITOR_ASAR_BINDING_MISMATCH');
  return installedSha;
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
      return {projects:projects.map(p=>({id:p.id,count:p.count,state:p.importState,analysis:p.analysisRunState,
          generation:p.analysisGeneration,originalCheck:p.automaticReviewLastRun ?? null})),
        photos:photos.map(p=>({id:p.id,file:p.fileName,analysis:p.analysis?.analysisLevel,
          sourceSha256:p.sourceFullSha256??null,automatic:p.automaticReview?.kind,crop:p.crop??null,
          edit:p.jpegEdit??null,undo:p.jpegEditUndo??null})),
        decisions:decisions.map(d=>({photoId:d.photoId,decision:d.decision,humanOverride:d.humanOverride===true})),
        groups:groups.map(g=>({id:g.id,photoIds:g.photoIds}))};
    } finally {db.close();}
  });
}

function verifyPhotoIdentities(photos, files) {
  const expected=new Map(files.map(file=>[path.basename(file.path),file.sha256]));
  assert.equal(expected.size,files.length,'Duplicate fixture name');
  assert.equal(photos.length,expected.size,'Stored photo count differs from fixture count');
  for (const photo of photos) {
    assert(expected.has(photo.file),'Unexpected or duplicate stored photo');
    assert.equal(photo.sourceSha256,expected.get(photo.file),'Stored original SHA differs');
    expected.delete(photo.file);
  }
  assert.equal(expected.size,0);
}

async function waitForRenderedProject(count) {
  return until(count=>{
    const all=document.querySelector('[data-filter-id="all"] strong');
    if (Number(all?.textContent)!==count) return false;
    return [...document.querySelectorAll('.photo-tile img')].some(img=>img.complete&&img.naturalWidth>0);
  },60000,count);
}

function verifyRetainedProject(before, after, files) {
  verifyPhotoIdentities(before.photos,files);
  verifyPhotoIdentities(after.photos,files);
  for (const [section,key] of [['projects','id'],['photos','id'],['groups','id'],['decisions','photoId']]) {
    const ordered=rows=>[...rows].sort((a,b)=>a[key].localeCompare(b[key]));
    assert.equal(after[section].length,before[section].length,'Upgrade changed '+section+' count');
    const expected=ordered(before[section]), actual=ordered(after[section]);
    for (let i=0;i<expected.length;i++) {
      assert.deepEqual(actual[i],expected[i],'Upgrade changed '+section+' record '+i);
    }
  }
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
  for (const key of Object.keys(env)) {
    if (/^(NODE_|PYTHON|OMC_|VITE_|VIRTUAL_ENV|ELECTRON_RUN_AS_NODE|GITHUB_TOKEN$|GH_TOKEN$)/i.test(key)) delete env[key];
  }
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
      await until(()=>!document.querySelector('.startup-splash'));
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

async function prepareWorkspace() {
  const identityPrompt = await ev(()=>[...document.querySelectorAll('.model-panel-dialog button')]
    .some(button=>button.innerText.trim()==='使用此编号开始选片'));
  if (identityPrompt) await click('使用此编号开始选片','.model-panel-dialog');
  const onboarding = await ev(()=>Boolean(document.querySelector('button[aria-label=跳过新手引导]')?.offsetWidth));
  if (onboarding) await click('跳过新手引导');
  return {identityPrompt,onboarding};
}

async function waitForCheck(check,description) {
  const deadline=Date.now()+60000;
  while(Date.now()<deadline && child.exitCode===null) {
    const value=await check();
    if(value) return value;
    await delay(180);
  }
  throw Error(description);
}

async function checkInstalledGroupEditor() {
  assert((await snapshot()).groups.some(group=>group.photoIds.length>1),'No actual AI group available for editor');
  await client.call('Emulation.setDeviceMetricsOverride',{width:1180,height:805,deviceScaleFactor:1,mobile:false});
  return exerciseGroupEditor({client,ev,until:waitForCheck,click:clickControl,readEdits:async()=>(await snapshot()).photos});
}

async function createUpgradeSeedEdits() {
  await clickControl('相似组','[aria-label="视图模式"] button');
  await until(()=>Boolean(document.querySelector('.workspace-shell--compare')));
  await click('裁切 JPEG');
  await until(()=>Boolean(document.querySelector('.crop-output-summary')));
  await click('16:9');
  await click('保存裁切（Enter）');
  await until(()=>!document.querySelector('.crop-output-summary'));
  const photo=await waitForCheck(async()=>(await snapshot()).photos.find(row=>row.crop),
    'Legacy crop did not persist');
  await click('调整 JPEG');
  let first;
  for (const fraction of [.62,.76]) {
    const slider=await until(fraction=>{
      const editor=document.querySelector('.exposure-dialog');
      const input=editor?.querySelector('input[aria-label="曝光 EV"]');
      if (!input || input.disabled || editor.dataset.previewQuality!=='refined') return null;
      input.scrollIntoView({block:'nearest'});
      const rect=input.getBoundingClientRect();
      const x=rect.x+rect.width*fraction,y=rect.y+rect.height/2;
      return document.elementFromPoint(x,y)===input ? {x,y,value:input.value}:null;
    },60000,fraction);
    for (const type of ['mousePressed','mouseReleased']) {
      await client.call('Input.dispatchMouseEvent',{type,x:slider.x,y:slider.y,button:'left',clickCount:1});
    }
    const value=await until(initial=>{
      const editor=document.querySelector('.exposure-dialog');
      const input=editor?.querySelector('input[aria-label="曝光 EV"]');
      const save=editor?.querySelector('button[aria-label="保存调整参数"]');
      return editor?.dataset.previewQuality==='refined'&&save&&!save.disabled&&input?.value!==initial
        ?input?.value:null;
    },60000,slider.value);
    await click('保存调整参数');
    const saved=await waitForCheck(async()=>{
      const row=(await snapshot()).photos.find(row=>row.id===photo.id);
      return row?.edit?.exposureEv===Number(value)?row:null;
    },'Legacy JPEG edit did not persist on the cropped photo');
    if (first===undefined) first=saved.edit;
    else assert.deepEqual(saved.undo?.previousRecipe,first,'Legacy adjustment undo was not recorded');
  }
  for (const type of ['rawKeyDown','keyUp']) {
    await client.call('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  }
  await until(()=>!document.querySelector('.exposure-dialog:not(.exposure-panel)'));
  return {crop:true,savedAdjustments:2,undo:true};
}

async function exerciseLegacyAdjustmentUndo({ev,until,click,photo,readPhoto}) {
  assert(photo.crop && photo.edit && photo.undo?.previousRecipe,'Missing legacy crop and adjustment history');
  await click('相似组','[aria-label="视图模式"] button');
  await until(()=>ev(()=>Boolean(document.querySelector('.workspace-shell--compare'))),
    'Legacy group view did not open');
  const target = `.gcp-img-wrap:has(img[alt=${JSON.stringify(photo.file)}])`;
  await click(null,target);
  await until(()=>ev(file=>document.querySelector('.gcp-detail-name')?.textContent===file,photo.file),
    'Legacy group photo did not become active');
  await click('调整 JPEG','.gcp-detail-edit-actions button');
  await click('撤销上次调整','.exposure-dialog:not(.exposure-panel) button');
  const restored = await until(async()=>{
    const row = await readPhoto(photo.id);
    return row && row.undo === null ? row : null;
  },'Legacy adjustment undo was not consumed');
  assert.deepEqual(restored.edit,photo.undo.previousRecipe,'Undo changed the legacy recipe');
  assert.deepEqual(restored.crop,photo.crop,'Undo changed the legacy crop');
  await click('关闭（不保存草稿）','.exposure-dialog:not(.exposure-panel) button');
  await until(()=>ev(()=>!document.querySelector('.exposure-dialog:not(.exposure-panel)')),
    'Adjustment dialog did not close after legacy undo');
  await click('返回','.group-compare-nav button');
  await until(()=>ev(()=>!document.querySelector('.workspace-shell--compare')),
    'Legacy group view did not return to the workspace');
  return restored;
}

async function verifyUpgrade(installedSha) {
  const seedPath=path.join(work,'UPGRADE-SEED.json');
  const seed=JSON.parse(fs.readFileSync(seedPath,'utf8'));
  assert.equal(seed.schema,'omc-native-upgrade-seed-v1');
  assert.match(seed.installedAsarSha256,/^[a-f0-9]{64}$/);
  assert.notEqual(seed.installedAsarSha256,installedSha,'Same ASAR cannot establish a version upgrade');
  assert.equal(seed.files.length,437);
  const files=seed.files.map(({name,sha256})=>{
    assert.match(name,/^qa-\d{3}\.jpg$/);
    assert.match(sha256,/^[a-f0-9]{64}$/);
    return {path:path.join(work,'fixtures',name),sha256};
  });
  report.fixtureSetSha256=fixtureSetDigest(files);
  report.legacyAsarSha256=seed.installedAsarSha256;
  report.seedReceiptSha256=digest(seedPath);
  await launch();
  await stage('same-profile-upgrade',async()=>{
    await waitForRenderedProject(files.length);
    const actual=await snapshot();
    verifyRetainedProject(seed.state,actual,files);
    return {photos:actual.photos.length,humanDecisions:actual.decisions.filter(row=>row.humanOverride).length,
      groups:actual.groups.length,crops:actual.photos.filter(row=>row.crop).length,
      edits:actual.photos.filter(row=>row.edit).length,undo:actual.photos.filter(row=>row.undo).length};
  });
  await stage('legacy-adjustment-undo',async()=>{
    const expected=structuredClone(seed.state);
    const photo=expected.photos.find(row=>row.crop&&row.edit&&row.undo?.previousRecipe);
    assert(photo,'Legacy seed lacks a previous adjustment recipe');
    await exerciseLegacyAdjustmentUndo({ev,until:waitForCheck,click:clickControl,photo,
      readPhoto:async id=>(await snapshot()).photos.find(row=>row.id===id)});
    photo.edit=photo.undo.previousRecipe;
    photo.undo=null;
    verifyRetainedProject(expected,await snapshot(),files);
    return {restoredExposureEv:photo.edit.exposureEv,retainedCrop:true};
  });
  await stage('group-editor',checkInstalledGroupEditor);
  const before=await snapshot();
  await close();
  await launch();
  await stage('candidate-reopen',async()=>{
    await waitForRenderedProject(files.length);
    verifyRetainedProject(before,await snapshot(),files);
    return {photos:files.length};
  });
  await close();
  assert(files.every(file=>digest(file.path)===file.sha256),'FIXTURE_BYTES_CHANGED');
  assert.equal(verifyEditorBinding(exe,editorBinding),installedSha);
}

// Shared native interaction. The caller must provide a disposable project with a real group.
async function exerciseGroupEditor({client,ev,until,click,readEdits}) {
  await click('相似组','[aria-label="视图模式"] button');
  await until(()=>ev(()=>Boolean(document.querySelector('.workspace-shell--compare'))),
    'Similar groups view did not open');
  await click('调整 JPEG');
  const dimensions = () => ev(() => {
    const stage=document.querySelector('.exposure-dialog:not(.exposure-panel) .exposure-stage');
    const img=stage?.querySelector('img');
    if(!img?.naturalWidth) return null;
    const {x,y,width,height}=stage.getBoundingClientRect();
    const scale=Math.min(img.clientWidth/img.naturalWidth,img.clientHeight/img.naturalHeight);
    return {x,y,width,height,paintedWidth:Math.round(img.naturalWidth*scale)};
  });
  const before=await until(dimensions,'Native editor has no preview');
  assert(before.y<110 && before.height>400 && before.paintedWidth>590, JSON.stringify(before));
  const slider=await until(()=>ev(()=>{
    const control=document.querySelector('.exposure-dialog input[aria-label="曝光 EV"]');
    if(!control || control.disabled) return null;
    control.scrollIntoView({block:'nearest'});
    const r=control.getBoundingClientRect();
    const y=r.y+r.height/2;
    return document.elementFromPoint(r.x+r.width*.51,y)===control
      ? {x:r.x,y,width:r.width,value:control.value}:null;
  }),'Native exposure slider is not interactive');
  await ev(()=>{
    window.__qaEditorInput=[];
    for(const type of ['pointerdown','pointermove','pointerup','input','change']) {
      document.addEventListener(type,event=>{
        if(window.__qaEditorInput.length<40) window.__qaEditorInput.push([
          type,event.target.tagName,event.target.getAttribute('aria-label'),event.target.value??null,event.buttons??null,
        ]);
      },{capture:true});
    }
  });
  const move=(fraction,type,buttons)=>client.call('Input.dispatchMouseEvent',{
    type,x:slider.x+slider.width*fraction,y:slider.y,
    button:type==='mouseMoved'&&!buttons?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1,
  });
  await move(.51,'mouseMoved',0);
  await move(.51,'mousePressed',1);
  const end=Number(slider.value)>0?.36:.73;
  for(const fraction of [.66,.78,.65,end]) {
    await move(fraction,'mouseMoved',1);
    assert.deepEqual(await dimensions(),before);
  }
  await move(end,'mouseReleased',0);
  const value=await until(()=>ev(initial=>{
    const v=document.querySelector('.exposure-dialog input[aria-label="曝光 EV"]')?.value;
    return v!==initial && v;
  },slider.value),'Native exposure slider did not change').catch(async error=>{
    throw Error(error.message+': '+JSON.stringify(await ev(()=>window.__qaEditorInput)));
  });
  await until(()=>ev(()=>document.querySelector('.exposure-dialog')?.dataset.previewQuality==='refined'),
    'Native refined preview unavailable');
  assert.deepEqual(await dimensions(),before);

  const key = async (name, virtualKey) => {
    for (const type of ['rawKeyDown','keyUp']) {
      await client.call('Input.dispatchKeyEvent',{type,key:name,code:name,windowsVirtualKeyCode:virtualKey});
    }
  };
  await ev(()=>{
    const field=document.querySelector('.exposure-dialog input[aria-label="曝光 EV 数值"]');
    field.focus(); field.select();
  });
  await client.call('Input.insertText',{text:'1.4'});
  await until(()=>ev(()=>document.querySelector('.exposure-dialog input[aria-label="曝光 EV 数值"]')?.value==='1.4'),
    'Native exposure text entry did not change');
  await key('Escape',27);
  await until(()=>ev(expected=>{
    const editor=document.querySelector('.exposure-dialog:not(.exposure-panel)');
    return editor?.querySelector('input[aria-label="曝光 EV 数值"]')?.value===expected
      && editor?.querySelector('input[aria-label="曝光 EV"]')?.value===expected;
  },value),'Native Escape did not restore the number field and preserve the editor');

  await client.call('Emulation.setDeviceMetricsOverride',{width:640,height:700,deviceScaleFactor:1,mobile:false});
  const compact=await until(dimensions,'Native compact editor has no preview');
  assert(compact.y<120 && compact.height>250 && compact.paintedWidth>400,JSON.stringify(compact));
  for (const group of [2,3]) {
    const selector=`.exposure-dialog .omc-adjust-group:nth-child(${group}) > summary`;
    const expanded=await ev(selector=>{
      const summary=document.querySelector(selector);
      summary.scrollIntoView({block:'nearest'});
      return summary.parentElement.open;
    },selector);
    if (!expanded) await click(null,selector);
  }
  assert.deepEqual(await dimensions(),compact);
  const controls=await ev(()=>[...document.querySelectorAll('.exposure-dialog input[type="range"]')]
    .map(input=>input.getAttribute('aria-label')));
  assert.equal(new Set(controls).size,15);
  const changed={};
  for (const label of controls) {
    const start=await ev(label=>{
      const input=[...document.querySelectorAll('.exposure-dialog input[type="range"]')]
        .find(item=>item.getAttribute('aria-label')===label);
      input.focus();
      return {value:input.value,max:input.max,focused:document.activeElement===input};
    },label);
    assert(start.focused,label);
    if (start.value===start.max) await key('ArrowLeft',37);
    else await key('ArrowRight',39);
    changed[label]=await until(()=>ev((label,initial)=>{
      const input=[...document.querySelectorAll('.exposure-dialog input[type="range"]')]
        .find(item=>item.getAttribute('aria-label')===label);
      return input?.value!==initial && input?.value;
    },label,start.value),'Native adjustment did not change: '+label);
    assert.deepEqual(await dimensions(),compact);
  }
  await until(()=>ev(()=>{
    const editor=document.querySelector('.exposure-dialog:not(.exposure-panel)');
    return editor?.dataset.previewQuality==='refined' && editor.getAttribute('aria-busy')==='false';
  }),'Native compact adjusted preview did not refine');
  const previousEdits=new Map((await readEdits()).map(row=>[row.id,JSON.stringify(row.edit)]));
  await click('保存调整参数');
  const expectedExposure=Number(changed['曝光 EV']);
  const edited=await until(async()=>{
    const rows=await readEdits();
    return rows.find(row=>row.edit?.exposureEv===expectedExposure
      && JSON.stringify(row.edit)!==previousEdits.get(row.id))?.edit;
  },
    'Native edit parameters did not persist');
  await click('关闭（不保存草稿）');
  await client.call('Emulation.setDeviceMetricsOverride',{width:1180,height:805,deviceScaleFactor:1,mobile:false});
  await click('调整 JPEG');
  await until(()=>ev(values=>{
    const dialog=document.querySelector('.exposure-dialog:not(.exposure-panel)');
    if (dialog?.getAttribute('aria-busy')!=='false') return false;
    const sliders=[...dialog.querySelectorAll('input[type="range"]')];
    return sliders.length===Object.keys(values).length
      && sliders.every(input=>values[input.getAttribute('aria-label')]===input.value);
  },changed),'Native saved values did not reload for all adjustments').catch(async error=>{
    const shown=await ev(()=>Object.fromEntries([...document.querySelectorAll('.exposure-dialog input[type="range"]')]
      .map(input=>[input.getAttribute('aria-label'),input.value])));
    throw Error(error.message+': '+JSON.stringify({wanted:changed,shown,stored:edited}));
  });
  await click('关闭（不保存草稿）');
  return {preview:before,compact,exposureEv:edited.exposureEv,changedControls:changed,
    numericEscapeRestored:true,allSavedControlsReloaded:true};
}

module.exports = {connect, exerciseGroupEditor, exerciseLegacyAdjustmentUndo, verifyEditorBinding};
if (require.main === module) (async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert.equal(process.env.GITHUB_REPOSITORY,'Siiiiimon123/OMC-build-checks');
  const branch=process.env.GITHUB_REF;
  assert(branch==='refs/heads/verify-preview24-high-use' ||
    (branch==='refs/heads/verify-native-candidate' && editorBinding),'Unexpected native test branch');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
  assert(path.resolve(work).startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep));
  try {
    assert(process.argv.length<=6,'Unexpected arguments');
    const editorSha=verifyEditorBinding(exe,editorBinding);
    const upgradeSeed=editorBinding?.startsWith('--upgrade-seed=');
    const upgradeVerify=editorBinding?.startsWith('--upgrade-verify=');
    if (editorSha) {
      report.scope='ASAR-bound native editor and workload, generated fixtures';
      report.installedAsarSha256=editorSha;
    }
    if (upgradeVerify) {
      report.scope='Two-ASAR native upgrade in the same disposable profile, generated fixtures';
      await verifyUpgrade(editorSha);
      report.status='PASS_SCOPED_NATIVE_UPGRADE';
      return;
    }
    if (upgradeSeed) report.scope='Legacy native upgrade seed, generated fixtures';
    const files=fixtures();
    if (editorSha) report.fixtureSetSha256=fixtureSetDigest(files);
    await stage('native-start',async()=>{
      await launch();
      return prepareWorkspace();
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
      const initial=await snapshot();
      const deadline=Date.now()+360000;
      let state=initial;
      while(Date.now()<deadline && child.exitCode===null) {
        assert.equal(state.projects.length,1);
        const project=state.projects[0];
        if(project.state==='complete') {
          assert.equal(state.photos.length,files.length);
          assert.equal(project.count,files.length);
          return {firstVisible:initial.photos.length,photos:state.photos.length};
        }
        assert.equal(project.state,'importing','Unexpected terminal import state');
        await delay(350);
        state=await snapshot();
      }
      throw Error('BATCH_IMPORT_TIMEOUT: '+state.photos.length+' of '+files.length);
    });
    await stage('batch-analysis',async()=>{
      const start=Date.now();
      let state;
      do {
        state=await snapshot();
        const analyzed=state.photos.filter(p=>p.analysis==='full_ai').length;
        const project=state.projects[0];
        const originalCheck=project.originalCheck;
        if(analyzed===files.length && project.analysis==='completed' && originalCheck
            && Number.isSafeInteger(project.generation) && originalCheck.generation===project.generation) {
          assert.equal(originalCheck.totalCount,files.length);
          assert.equal(originalCheck.failureCount,0,'Native original checks failed');
          assert.equal(originalCheck.focusSkippedCount,0,'Native subject checks were skipped');
          assert.equal(originalCheck.inspectedCount,originalCheck.candidateCount);
          const automatic=state.photos.filter(p=>p.automatic).length;
          assert.equal(originalCheck.classifiedCount,automatic);
          return {analyzed,groups:state.groups.length,automatic,
            originalCandidates:originalCheck.candidateCount,originalsInspected:originalCheck.inspectedCount};
        }
        if(['partial','failed','interrupted','canceled'].includes(project.analysis))
          throw Error('BATCH_ANALYSIS_INCOMPLETE: '+project.analysis+' full='+analyzed);
        await delay(1200);
      } while(Date.now()-start<720000);
      throw Error('BATCH_ANALYSIS_OR_ORIGINAL_CHECK_TIMEOUT: '+state.photos.filter(p=>p.analysis==='full_ai').length);
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
    if (editorSha) await stage(upgradeSeed?'legacy-group-edits':'group-editor',async()=>{
      const state=await snapshot();
      verifyPhotoIdentities(state.photos,files);
      assert(state.decisions.some(row=>row.decision==='keep'&&row.humanOverride),'Manual decision not recorded as a human override');
      assert(state.groups.some(group=>group.photoIds.length>1),'No actual AI group available for editor');
      return upgradeSeed?createUpgradeSeedEdits():checkInstalledGroupEditor();
    });
    let seedState;
    await stage('close-and-reopen',async()=>{
      const before=await snapshot();
      await close();
      await launch();
      if (editorSha) await waitForRenderedProject(files.length);
      else await until(()=>Boolean(document.querySelector('.photo-tile')));
      const after=await snapshot();
      assert.deepEqual(after,before);
      if (editorSha) verifyPhotoIdentities(after.photos,files);
      if (upgradeSeed) seedState=after;
      return {photos:after.photos.length,decisions:after.decisions.length};
    });
    await close();
    assert(files.every(file=>digest(file.path)===file.sha256),'FIXTURE_BYTES_CHANGED');
    if (editorSha) assert.equal(verifyEditorBinding(exe,editorBinding),editorSha);
    if (upgradeSeed) {
      assert(seedState?.photos.some(photo=>photo.crop&&photo.edit&&photo.undo),'Legacy seed lacks adjustment history');
      const seed={schema:'omc-native-upgrade-seed-v1',installedAsarSha256:editorSha,state:seedState,
        files:files.map(file=>({name:path.basename(file.path),sha256:file.sha256}))};
      fs.writeFileSync(path.join(work,'UPGRADE-SEED.json'),JSON.stringify(seed),{flag:'wx'});
      report.status='PASS_SCOPED_NATIVE_UPGRADE_SEED';
    } else report.status=editorSha?'PASS_SCOPED_NATIVE_EDITOR':'PASS_SCOPED_NATIVE_BASELINE';
  } catch(error) {
    report.status='FAIL';
    report.error=String(error.stack??error).slice(0,4000);
    console.error(report.error);
    process.exitCode=1;
  } finally {
    if(client) client.close();
    if(child?.exitCode===null) child.kill();
    fs.writeFileSync(path.join(work,'BASELINE.json'),JSON.stringify(report,null,2));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

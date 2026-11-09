import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {once} from 'node:events';

const [exe,profile,report] = process.argv.slice(2);
assert(process.platform==='win32' && process.env.GITHUB_ACTIONS==='true');
assert(process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks');
fs.mkdirSync(profile);
const child=spawn(exe,['--user-data-dir='+profile,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],
  {stdio:'ignore',windowsHide:true});
const closed=once(child,'close');
const portFile=path.join(profile,'DevToolsActivePort');
let browser;
const deadline=Date.now()+45000;
try{
  while(!fs.existsSync(portFile) && Date.now()<deadline && child.exitCode===null)await delay(100);
  const [port,browserPath]=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);
  assert(/^[1-9][0-9]{0,4}$/.test(port)&&/^\/devtools\/browser\/[a-f0-9-]+$/.test(browserPath));
  const base='http://127.0.0.1:'+port;
  async function connect(url){
    assert(url.startsWith('ws://127.0.0.1:'+port+'/devtools/'));
    const ws=new WebSocket(url);
    await Promise.race([once(ws,'open'),delay(6000).then(()=>{throw Error('CDP_OPEN_TIMEOUT')})]);
    return ws;
  }
  browser=await connect('ws://127.0.0.1:'+port+browserPath);
  let target;
  while(Date.now()<deadline){
    const pages=await (await fetch(base+'/json/list',{signal:AbortSignal.timeout(4000)})).json();
    target=pages.find(p=>p.type==='page'&&p.url.startsWith('file:')&&p.url.endsWith('/dist/index.html'));
    if(target)break;
    await delay(150);
  }
  assert(target,'OMC_RENDERER_MISSING');
  const page=await connect(target.webSocketDebuggerUrl);
  let next=0;
  function evaluate(expression){
    const id=++next;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{page.removeEventListener('message',listen);reject(Error('CDP_EVALUATE_TIMEOUT'))},6000);
      function listen(event){const m=JSON.parse(event.data);if(m.id!==id)return;clearTimeout(timeout);
        page.removeEventListener('message',listen);resolve(m.result?.result?.value);}
      page.addEventListener('message',listen);
      page.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
    });
  }
  let status;
  try{
    while(Date.now()<deadline){
      status=await evaluate("document.querySelector('#root')?.childElementCount && window.electronAPI?.getUpdateStatus?.()");
      if(status?.state==='idle'&&status.distributionTrust?.platform==='win32')break;
      await delay(150);
    }
    assert(status?.state==='idle'&&status.distributionTrust?.platform==='win32','OMC_RENDERER_OR_UPDATE_STATUS');
  }finally{page.close();}
  browser.send(JSON.stringify({id:1,method:'Browser.close'}));
  const [code,signal]=await Promise.race([closed,delay(15000).then(()=>{throw Error('NATIVE_EXIT_TIMEOUT')})]);
  assert(code===0&&!signal);
  fs.writeFileSync(report,JSON.stringify({status:'PASS_NATIVE_WINDOWS_REGISTERED_ENTRY',normalExit:true})+'\n',{flag:'wx'});
}finally{
  browser?.close();
  if(child.exitCode===null)child.kill();
}

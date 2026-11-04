import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {inspector} from './controlled-cdp.mjs';
test('one-shot main inspector closes before the inspected process exits',async()=>{
 const child=spawn(process.execPath,['--inspect=127.0.0.1:0','-e','setTimeout(()=>{},1200)'],{stdio:['ignore','ignore','pipe']});let log='';
 const exited=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 try{
  const endpoint=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('ENDPOINT_TIMEOUT')),5000);child.stderr.on('data',chunk=>{log+=chunk;const m=log.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/);if(m){clearTimeout(t);resolve(m[1]);}});});
  const session=await inspector(endpoint);assert.equal(await session.evaluate('1+1'),2);await session.closeAndWait();
  const result=await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('PROCESS_EXIT_TIMEOUT')),5000))]);assert.equal(result.code,0);assert.equal(result.signal,null);
 }finally{if(child.exitCode===null)child.kill();}
});

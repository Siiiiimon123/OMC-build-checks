'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {installControlledRoute}=require('./controlled-route.cjs');
const config={formalMetadataPrefix:'https://omc.xiaoa.cyou/updates/metadata/',qaMetadataPrefix:'https://omc.xiaoa.cyou/updates/qa-r1/751f418b0692a13547eefe6765369a2f/'};
test('routes metadata and targets to the same QA nonce, preserves requests and rejects redirects and unsafe paths',async()=>{
 const saved=globalThis.fetch;let calls=[];globalThis.fetch=async(input,options)=>{calls.push({input,options});return {status:200,url:typeof input==='string'?input:input.url};};
 try {
  installControlledRoute(config);
  const meta='https://omc.xiaoa.cyou/updates/metadata/targets.json';
  assert.equal((await fetch(meta)).url,meta);assert.equal(calls[0].input,config.qaMetadataPrefix+'targets.json');
  const hash='a'.repeat(64),target='https://omc.xiaoa.cyou/updates/targets/releases/'+hash+'.a.pkg';
  const req=new Request(target,{headers:{'x-test':'yes'}});assert.equal((await fetch(req)).url,target);assert.equal(calls[1].input.url,config.qaMetadataPrefix+'targets/releases/'+hash+'.a.pkg');assert.equal(calls[1].input.headers.get('x-test'),'yes');assert.equal(calls[1].options.redirect,'manual');
  await fetch('https://example.com/other');assert.equal(calls[2].input,'https://example.com/other');
  await fetch('https://OMC.XIAOA.CYOU:443/updates/targets/releases/b.pkg');assert.equal(calls[3].input,config.qaMetadataPrefix+'targets/releases/b.pkg');
  for(const tail of ['../escape','%2e%2e/escape','a.pkg?x=1','a.pkg#x'])await assert.rejects(fetch('https://omc.xiaoa.cyou/updates/targets/'+tail));
  for(const path of ['/updates/%74argets/releases/a.pkg','/updates/%6detadata/targets.json','/updates%2ftargets/releases/a.pkg','/%75pdates/%74argets/a.pkg','//updates/targets/a.pkg','/updates/targets\\releases/a.pkg'])await assert.rejects(fetch('https://omc.xiaoa.cyou'+path));
  assert.equal(globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__.targetRequestsRouted,2);
  assert.equal(globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__.packageRequestsRouted,1);assert.equal(globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__.packageSha256Routed,hash);
 } finally {globalThis.fetch=saved;delete globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__;}
});
test('rejects actual redirects',async()=>{const saved=globalThis.fetch;globalThis.fetch=async()=>({status:302,url:''});try{installControlledRoute(config);await assert.rejects(fetch(config.formalMetadataPrefix+'targets.json'),/QA_ACTUAL_TRANSPORT_REDIRECT/);}finally{globalThis.fetch=saved;delete globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__;}});
test('failed package response cannot count as evidence',async()=>{const saved=globalThis.fetch;globalThis.fetch=async url=>({status:404,url});try{installControlledRoute(config);await fetch('https://omc.xiaoa.cyou/updates/targets/releases/'+'a'.repeat(64)+'.release.pkg');assert.equal(globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__.packageRequestsRouted,0);assert.equal(globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__.packageSha256Routed,null);}finally{globalThis.fetch=saved;delete globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__;}});

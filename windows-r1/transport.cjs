'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const SCHEMA = 'omc-aes256gcm-build-transport-v1';
const MAX = 2 * 1024 ** 3 - 1;
function fail(code) { throw new Error(code); }
function hex(value, n) { return typeof value === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(value); }
function validate(a) {
  if (!a || !/^[a-z][a-z0-9-]{0,31}$/.test(a.id) || !Number.isSafeInteger(a.plaintextBytes) || a.plaintextBytes < 1 || a.plaintextBytes > MAX || a.ciphertextBytes !== a.plaintextBytes || !hex(a.plaintextSha256,64) || !hex(a.ciphertextSha256,64) || !hex(a.nonceHex,24) || !hex(a.tagHex,32)) fail('INVALID_MANIFEST');
}
function aad(a) { return Buffer.from(`${SCHEMA}|${a.id}|${a.plaintextSha256}|${a.plaintextBytes}`); }
function meter(max, onBytes) {
  let bytes = 0; const hash = crypto.createHash('sha256');
  const stream = new Transform({ transform(b, e, cb) { bytes += b.length; if(onBytes) onBytes(b.length); if(bytes > max) return cb(new Error('SIZE_LIMIT')); hash.update(b); cb(null,b); }});
  return { stream, result: () => ({bytes, sha256:hash.digest('hex')}) };
}
async function inspect(p) {
  const s = await fsp.lstat(p); if(!s.isFile() || s.isSymbolicLink() || s.size < 1 || s.size > MAX) fail('INVALID_INPUT');
  const m = meter(MAX); await pipeline(fs.createReadStream(p),m.stream,new Transform({transform(b,e,cb){cb();}}));
  const r=m.result(); if(r.bytes !== s.size) fail('INPUT_CHANGED'); return {...r, identity:s};
}
async function sameInput(p,s) { const t=await fsp.lstat(p); if(!t.isFile() || t.isSymbolicLink() || t.size!==s.size || t.mtimeMs!==s.mtimeMs || t.ino!==s.ino) fail('INPUT_CHANGED'); }
async function absent(p) { try { await fsp.lstat(p); fail('OUTPUT_EXISTS'); } catch(e) {if(e.code !== 'ENOENT') throw e;} }
async function commit(temp,out) { await fsp.link(temp,out); await fsp.unlink(temp); }
async function encrypt({input,output,id,key,expectedSha,expectedBytes}) {
  await absent(output); const info=await inspect(input);
  if((expectedSha && info.sha256!==expectedSha)||(expectedBytes && info.bytes!==Number(expectedBytes))) fail('FROZEN_INPUT_MISMATCH');
  const a={id, plaintextBytes:info.bytes,plaintextSha256:info.sha256,ciphertextBytes:info.bytes,nonceHex:crypto.randomBytes(12).toString('hex')};
  if(!/^[a-z][a-z0-9-]{0,31}$/.test(id)) fail('INVALID_ID');
  const cipher=crypto.createCipheriv('aes-256-gcm',key,Buffer.from(a.nonceHex,'hex')); cipher.setAAD(aad(a));
  const plain=meter(info.bytes), encrypted=meter(info.bytes); const temp=output+'.'+crypto.randomUUID()+'.part';
  try {
    await pipeline(fs.createReadStream(input),plain.stream,cipher,encrypted.stream,fs.createWriteStream(temp,{flags:'wx',mode:0o600}));
    const pr=plain.result(),cr=encrypted.result(); await sameInput(input,info.identity);
    if(pr.bytes!==info.bytes||pr.sha256!==info.sha256||cr.bytes!==info.bytes) fail('INPUT_CHANGED');
    a.ciphertextSha256=cr.sha256;a.tagHex=cipher.getAuthTag().toString('hex');validate(a);
    await commit(temp,output);return a;
  } finally { await fsp.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;}); }
}
async function decryptStream(source,a,output,key,onBytes) {
  validate(a);await absent(output); const temp=output+'.'+crypto.randomUUID()+'.part';
  const cipherMeter=meter(a.ciphertextBytes,onBytes),plainMeter=meter(a.plaintextBytes);
  const dec=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(a.nonceHex,'hex'));dec.setAAD(aad(a));dec.setAuthTag(Buffer.from(a.tagHex,'hex'));
  try {
    await pipeline(source,cipherMeter.stream,dec,plainMeter.stream,fs.createWriteStream(temp,{flags:'wx',mode:0o600}));
    const c=cipherMeter.result(),p=plainMeter.result();
    if(c.bytes!==a.ciphertextBytes||c.sha256!==a.ciphertextSha256||p.bytes!==a.plaintextBytes||p.sha256!==a.plaintextSha256)fail('CONTENT_MISMATCH');
    await commit(temp,output);return {id:a.id,bytes:p.bytes,sha256:p.sha256,authenticated:true};
  } finally {await fsp.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
// Production bounds: at most three attempts, 30 s without bytes, 150 s per
// attempt and 275 s overall (including backoff). Overrides are for local tests.
async function fetchAsset(a,output,key,options={}) {
  validate(a); await absent(output);
  const sources=a.urls===undefined?[a.url]:a.urls;
  if(!Array.isArray(sources)||sources.length===0||sources.some(x=>typeof x!=='string'||!x)) fail('INVALID_MANIFEST');
  const parsed=sources.map(x=>{let url;try{url=new URL(x);}catch{fail('HTTPS_REQUIRED');}if(url.protocol!=='https:'||url.username||url.password) fail('HTTPS_REQUIRED');return url;});
  const token=(process.env.GITHUB_TOKEN||'').trim()||(process.env.GH_TOKEN||'').trim();
  const isGithubAsset=url=>url.origin==='https://api.github.com'&&/^\/repos\/[^/]+\/[^/]+\/releases\/assets\/\d+\/?$/.test(url.pathname);
  const urls=parsed.filter(url=>token||!isGithubAsset(url));
  if(!urls.length) fail('NO_AVAILABLE_SOURCE');
  const {idleTimeoutMs=30000,attemptTimeoutMs=150000,totalTimeoutMs=275000,maxAttempts=3,backoffMs=2000,progressIntervalMs=15000}=options;
  const deadline=Date.now()+totalTimeoutMs;
  let lastError;
  for(let attempt=1;attempt<=maxAttempts;attempt++) {
    const remaining=deadline-Date.now();if(remaining<=0) break;
    const started=Date.now(), controller=new AbortController();
    const initial=urls[(attempt-1)%urls.length];
    let host=initial.host,status=null,bytes=0,reason=null,source=null,idleTimer;
    const log=(event,why=null)=>process.stderr.write(JSON.stringify({event,attempt,status,bytes,elapsedMs:Date.now()-started,reason:why,host})+'\n');
    const abort=(why)=>{if(reason) return;reason=why;controller.abort();if(source) source.destroy(new Error(why));};
    const resetIdle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>abort('IDLE_TIMEOUT'),idleTimeoutMs);};
    const attemptTimer=setTimeout(()=>abort(remaining<=attemptTimeoutMs?'TOTAL_TIMEOUT':'ATTEMPT_TIMEOUT'),Math.min(attemptTimeoutMs,remaining));
    const progress=setInterval(()=>log('progress'),progressIntervalMs);
    resetIdle();log('attempt_start');
    let retry=false,stage='fetch';
    try {
      let url=initial,response,visitedGithubApi=false;
      for(let redirects=0;;redirects++) {
        host=url.host;
        if(!token&&isGithubAsset(url)) {const error=new Error('NO_TOKEN_FOR_GITHUB_ASSET');error.retryable=true;throw error;}
        const headers={};
        if(url.origin==='https://api.github.com') {
          visitedGithubApi=true;
          headers.Accept='application/octet-stream';
          if(token) headers.Authorization=`Bearer ${token}`;
        }
        response=await fetch(url,{signal:controller.signal,redirect:'manual',headers});status=response.status;log('headers');
        if([301,302,303,307,308].includes(status)) {
          const location=response.headers.get('location');
          if(response.body) response.body.cancel().catch(()=>{});
          if(!location||redirects>=5) fail('DOWNLOAD_REDIRECT');
          url=new URL(location,url);if(url.protocol!=='https:'||url.username||url.password) fail('HTTPS_REQUIRED');
          continue;
        }
        break;
      }
      if(!response.ok||!response.body) {
        if(response.body) response.body.cancel().catch(()=>{});
        const error=new Error('DOWNLOAD_FAILED');
        error.retryable=status===408||status===429||status>=500||(visitedGithubApi&&[401,403,404].includes(status));throw error;
      }
      const length=response.headers.get('content-length');
      if(length && Number(length)!==a.ciphertextBytes) {response.body.cancel().catch(()=>{});fail('DOWNLOAD_LENGTH');}
      source=Readable.fromWeb(response.body);source.on('error',()=>{});stage='body';
      const result=await decryptStream(source,a,output,key,n=>{bytes+=n;resetIdle();});
      log('attempt_end','SUCCESS');return result;
    } catch(error) {
      lastError=error;
      const networkCodes=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','ENOTFOUND','EAI_AGAIN','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
      let cause=error,network=false;
      for(let depth=0;cause&&depth<5;depth++,cause=cause.cause) if(networkCodes.has(cause.code)) network=true;
      // Do not classify a cryptographic, size, manifest or filesystem error as a
      // network failure merely because an abort happened at the same time.
      const aborted=reason && (error.message===reason||error.name==='AbortError'||error.code==='ABORT_ERR');
      retry=Boolean(error.retryable||aborted||network||(stage==='fetch'&&error.name==='TypeError'));
      const knownReasons=new Set(['CONTENT_MISMATCH','INVALID_MANIFEST','DOWNLOAD_LENGTH','DOWNLOAD_FAILED','DOWNLOAD_REDIRECT','HTTPS_REQUIRED','SIZE_LIMIT']);
      log('attempt_end',aborted?reason:(error.retryable?'HTTP_RETRYABLE':network?'NETWORK_ERROR':knownReasons.has(error.message)?error.message:'NON_RETRYABLE'));
    } finally {clearTimeout(idleTimer);clearTimeout(attemptTimer);clearInterval(progress);}
    if(!retry||attempt===maxAttempts||deadline<=Date.now()) throw lastError;
    await new Promise(resolve=>setTimeout(resolve,Math.min(backoffMs*2**(attempt-1),Math.max(0,deadline-Date.now()))));
  }
  throw lastError||new Error('TOTAL_TIMEOUT');
}
async function main() {
  const [action,...args]=process.argv.slice(2); const options={};for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1])fail('ARGUMENTS'); options[args[i].slice(2)]=args[i+1];}
  const raw=options['key-file']?(await fsp.readFile(options['key-file'],'utf8')).trim():process.env.OMC_PREVIEW15_TRANSPORT_KEY;
  if(!hex(raw,64))fail('KEY_REQUIRED');const key=Buffer.from(raw,'hex');
  if(action==='encrypt'){
    const a=await encrypt({input:options.input,output:options.output,id:options.id,key,expectedSha:options['expected-sha'],expectedBytes:options['expected-bytes']});
    await fsp.writeFile(options.manifest,JSON.stringify({schema:SCHEMA,assets:[a]},null,2)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify({id:a.id,bytes:a.plaintextBytes,sha256:a.plaintextSha256,encrypted:true})+'\n');
  }else if(action==='fetch'||action==='decrypt'){
    const m=JSON.parse(await fsp.readFile(options.manifest,'utf8'));if(m.schema!==SCHEMA||!Array.isArray(m.assets)||m.assets.filter(x=>x.id===options.id).length!==1)fail('INVALID_MANIFEST');
    const a=m.assets.find(x=>x.id===options.id);validate(a);
    const result=action==='fetch'?await fetchAsset(a,options.output,key):await decryptStream(fs.createReadStream(options.input),a,options.output,key);
    process.stdout.write(JSON.stringify(result)+'\n');
  }else fail('ACTION_INVALID');
}
module.exports={SCHEMA,encrypt,decryptStream,fetchAsset,validate};
if(require.main===module)main().catch(()=>{process.stderr.write('TRANSPORT_FAILED\n');process.exitCode=1;});

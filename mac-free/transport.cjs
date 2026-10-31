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
function meter(max) {
  let bytes = 0; const hash = crypto.createHash('sha256');
  const stream = new Transform({ transform(b, e, cb) { bytes += b.length; if(bytes > max) return cb(new Error('SIZE_LIMIT')); hash.update(b); cb(null,b); }});
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
async function decryptStream(source,a,output,key) {
  validate(a);await absent(output); const temp=output+'.'+crypto.randomUUID()+'.part';
  const cipherMeter=meter(a.ciphertextBytes),plainMeter=meter(a.plaintextBytes);
  const dec=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(a.nonceHex,'hex'));dec.setAAD(aad(a));dec.setAuthTag(Buffer.from(a.tagHex,'hex'));
  try {
    await pipeline(source,cipherMeter.stream,dec,plainMeter.stream,fs.createWriteStream(temp,{flags:'wx',mode:0o600}));
    const c=cipherMeter.result(),p=plainMeter.result();
    if(c.bytes!==a.ciphertextBytes||c.sha256!==a.ciphertextSha256||p.bytes!==a.plaintextBytes||p.sha256!==a.plaintextSha256)fail('CONTENT_MISMATCH');
    await commit(temp,output);return {id:a.id,bytes:p.bytes,sha256:p.sha256,authenticated:true};
  } finally {await fsp.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function fetchAsset(a,output,key) {
  const u=new URL(a.url);if(u.protocol!=='https:'||u.username||u.password) fail('HTTPS_REQUIRED');
  const response=await fetch(u,{signal:AbortSignal.timeout(70*60*1000)});
  if(!response.ok||!response.body)fail('DOWNLOAD_FAILED');
  const length=response.headers.get('content-length');if(length && Number(length)!==a.ciphertextBytes)fail('DOWNLOAD_LENGTH');
  return decryptStream(Readable.fromWeb(response.body),a,output,key);
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

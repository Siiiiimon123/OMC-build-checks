// Transport-only split of an existing ciphertext ZIP; no key, decryption or build.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {Writable} from 'node:stream';
assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks');
assert(process.env.GITHUB_REF==='refs/heads/verify-final-package19'&&process.env.GITHUB_RUN_ATTEMPT==='1');
const artifact=13398140152,bytes=983623986,sha='6346ff1a22dbdb2d4f08eda00bce38815eea6a3458a29e85f36d4b8986e203de';
const root=path.join(process.env.RUNNER_TEMP,'omc-mac19-cipher-transfer');assert(!fs.existsSync(root));fs.mkdirSync(root);
const token=process.env.GH_TOKEN;assert(token);delete process.env.GH_TOKEN;
const endpoint='https://api.github.com/repos/Siiiiimon123/OMC-build-checks/actions/artifacts/'+artifact;
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json'};
const metaResponse=await fetch(endpoint,{headers,signal:AbortSignal.timeout(30000)});assert(metaResponse.ok,'ARTIFACT_META_ACCESS');
const meta=await metaResponse.json();assert(meta.id===artifact&&meta.size_in_bytes===bytes&&meta.digest==='sha256:'+sha&&!meta.expired,'EXACT_ARTIFACT_IDENTITY');
const response=await fetch(endpoint+'/zip',{headers,signal:AbortSignal.timeout(8*60*1000)});assert(response.ok&&response.body,'CIPHER_DOWNLOAD');
const LIMIT=256*1024*1024,whole=crypto.createHash('sha256'),parts=[];let total=0,fd=null,count=0,partHash=null,name=null;
function finishPart(){if(fd===null)return;fs.fsyncSync(fd);fs.closeSync(fd);parts.push({name,bytes:count,sha256:partHash.digest('hex')});fd=null;}
const sink=new Writable({write(chunk,encoding,callback){try{
 whole.update(chunk);total+=chunk.length;assert(total<=bytes,'ARTIFACT_TOO_LONG');let offset=0;
 while(offset<chunk.length){
  if(fd===null){name='part-'+String(parts.length).padStart(3,'0')+'.bin';fd=fs.openSync(path.join(root,name),'wx',0o600);count=0;partHash=crypto.createHash('sha256');}
  const end=Math.min(chunk.length,offset+LIMIT-count),piece=chunk.subarray(offset,end);let written=0;
  while(written<piece.length)written+=fs.writeSync(fd,piece,written,piece.length-written);
  partHash.update(piece);count+=piece.length;offset=end;if(count===LIMIT)finishPart();
 }
 callback();
}catch(error){callback(error);}},final(callback){try{finishPart();assert(total===bytes&&whole.digest('hex')===sha,'WHOLE_CIPHERTEXT_ZIP_MISMATCH');callback();}catch(error){callback(error);}}});
try{await pipeline(Readable.fromWeb(response.body),sink);}finally{if(fd!==null)fs.closeSync(fd);}
assert(parts.length===4&&parts.every(p=>p.bytes<=LIMIT));
const index={schema:'omc-existing-cipher-artifact-split-v1',originalArtifact:artifact,originalRun:41988278277,
 originalBytes:bytes,originalSha256:sha,parts,productBytesChanged:false,sourceOrModelRebuilt:false,
 decryptionPerformed:false,secretUsed:false,publicPlaintextAdded:false,feeUSD:0};
fs.writeFileSync(path.join(root,'INDEX.json'),JSON.stringify(index,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(index));

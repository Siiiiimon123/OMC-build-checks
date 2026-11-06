'use strict';
// Exactly one public Apache-2.0 model, staged only on the owned build VM.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const assert=require('node:assert/strict');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
 assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks');
 const [source,reports]=process.argv.slice(2),c=JSON.parse(fs.readFileSync(path.join(source,'contracts/frontend-subject-runtime-v1.json'))),a=c.asset;
 assert(c.license==='Apache-2.0'&&a.sizeBytes===4563519&&a.sha256==='2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b');
 const target=path.join(source,'public/models/subject_person.tflite');assert(a.path==='public/models/subject_person.tflite');
 if(!fs.existsSync(target)){
  const r=await fetch(a.downloadUrl,{signal:AbortSignal.timeout(90000)});assert(r.ok);
  let size=0;const chunks=[];for await(const b of r.body){size+=b.length;assert(size<=a.archiveSizeBytes);chunks.push(b);}
  const archive=Buffer.concat(chunks);assert(size===a.archiveSizeBytes&&hash(archive)===a.archiveSha256);
  const tar=zlib.gunzipSync(archive,{maxOutputLength:7000000}),members=[];
  for(let off=0;off+512<=tar.length;){const h=tar.subarray(off,off+512),name=h.subarray(0,100).toString().replace(/\0.*$/s,''),n=parseInt(h.subarray(124,136).toString().replace(/\0.*$/s,'').trim()||'0',8);if(!name)break;assert(Number.isSafeInteger(n)&&n>=0&&off+512+n<=tar.length);members.push({name,bytes:tar.subarray(off+512,off+512+n)});off+=512+Math.ceil(n/512)*512;}
  assert(members.length===1&&members[0].name===a.archiveMember);const bytes=members[0].bytes;
  assert(bytes.length===a.sizeBytes&&hash(bytes)===a.sha256);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});
 }
 const bytes=fs.readFileSync(target);assert(bytes.length===a.sizeBytes&&hash(bytes)===a.sha256);
 fs.writeFileSync(path.join(reports,'SUBJECT_MODEL_PROVISION.json'),JSON.stringify({status:'PASS',path:a.path,bytes:bytes.length,sha256:a.sha256,license:c.license,memberDownloadRequired:false})+'\n',{flag:'wx'});
}
main().catch(e=>{console.error(String(e.message));process.exitCode=1;});

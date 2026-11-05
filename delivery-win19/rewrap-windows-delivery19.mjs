// Reuse approved AES-GCM transport; derive a key for this ONE installer only.
// No source/model rebuild, product execution, photo access or general-key export.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),transportFile=new URL('../final19/transport.cjs',import.meta.url);
assert(crypto.createHash('sha256').update(fs.readFileSync(transportFile)).digest('hex')==='19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f','REVIEWED_TRANSPORT_BYTES');
const transport=require('../final19/transport.cjs');
assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks');
assert(process.env.GITHUB_REF==='refs/heads/verify-final-package19'&&process.env.GITHUB_RUN_ATTEMPT==='1');
const artifact=13402959173,zipBytes=803594126,zipSha='fe797487c19c48014add51b246b259d25df5695a7c42d0de2eed03f1cf9190ad';
const BYTES=803348413,SHA='daade4392f5b77262fbd1f53b4ffbcb89e73290952f1a0779739c0ff8d97eb27';
const CONTEXT='omc-final-installer-delivery-v1|windows-x64|803348413|'+SHA;
const root=path.join(process.env.RUNNER_TEMP,'omc-win19-scoped-delivery');assert(!fs.existsSync(root));fs.mkdirSync(root);
const raw=process.env.OMC_PREVIEW15_TRANSPORT_KEY;assert(/^[a-f0-9]{64}$/.test(raw));delete process.env.OMC_PREVIEW15_TRANSPORT_KEY;
const master=Buffer.from(raw,'hex'),scoped=crypto.createHmac('sha256',master).update(CONTEXT,'utf8').digest();assert(!scoped.equals(master),'SCOPED_KEY_MUST_DIFFER');
const token=process.env.GH_TOKEN;assert(token);delete process.env.GH_TOKEN;
try{
 const endpoint='https://api.github.com/repos/Siiiiimon123/OMC-build-checks/actions/artifacts/'+artifact,headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json'};
 const mr=await fetch(endpoint,{headers,signal:AbortSignal.timeout(30000)});assert(mr.ok,'ORIGINAL_ARTIFACT_METADATA');const m=await mr.json();assert(m.id===artifact&&m.size_in_bytes===zipBytes&&m.digest==='sha256:'+zipSha&&!m.expired,'IMMUTABLE_ORIGINAL_ARTIFACT');
 const r=await fetch(endpoint+'/zip',{headers,signal:AbortSignal.timeout(5*60*1000)});assert(r.ok&&r.body,'ORIGINAL_CIPHER_DOWNLOAD');
 let n=0;const h=crypto.createHash('sha256'),archive=path.join(root,'original.zip');
 await pipeline(Readable.fromWeb(r.body),new Transform({transform(b,e,cb){n+=b.length;if(n>zipBytes)return cb(Error('ZIP_OVERSIZE'));h.update(b);cb(null,b);}}),fs.createWriteStream(archive,{flags:'wx',mode:0o600}));assert(n===zipBytes&&h.digest('hex')===zipSha,'ORIGINAL_ZIP_SHA');
 const extract=`import sys,zipfile,shutil,pathlib
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(root/'original.zip') as z:
 assert set(z.namelist())=={'package.enc','PACKAGE_READY.json'}
 assert z.getinfo('package.enc').file_size==803348413 and z.getinfo('PACKAGE_READY.json').file_size<4096
 for name in z.namelist():
  with z.open(name) as r,(root/name).open('xb') as w:shutil.copyfileobj(r,w,1048576)
`;
 assert(spawnSync('python3',['-c',extract,root],{stdio:'inherit',timeout:60000}).status===0,'EXTRACT_FIXED_CIPHER');
 const old=JSON.parse(fs.readFileSync(path.join(root,'PACKAGE_READY.json'),'utf8'));assert(old.schema===transport.SCHEMA&&old.assets.length===1);const original=old.assets[0];transport.validate(original);assert(original.id==='pkg'&&original.plaintextBytes===BYTES&&original.plaintextSha256===SHA,'ORIGINAL_INSTALLER_IDENTITY');
 const plain=path.join(root,'verified-installer.exe');
 await transport.decryptStream(fs.createReadStream(path.join(root,'package.enc')),original,plain,master);
 const cipher=path.join(root,'scoped-package.enc');
 const asset=await transport.encrypt({input:plain,output:cipher,id:'pkg',key:scoped,expectedSha:SHA,expectedBytes:BYTES});
 // All removed files are this job's reproducible intermediates, never user data.
 for(const name of ['verified-installer.exe','package.enc','original.zip'])fs.unlinkSync(path.join(root,name));
 const parts=[];let fd=null,count=0,partHash=null,name=null;const whole=crypto.createHash('sha256');let total=0;
 const finish=()=>{if(fd===null)return;fs.fsyncSync(fd);fs.closeSync(fd);parts.push({name,bytes:count,sha256:partHash.digest('hex')});fd=null;};
 try{for await(const b of fs.createReadStream(cipher)){whole.update(b);total+=b.length;let offset=0;while(offset<b.length){if(fd===null){name='part-'+String(parts.length).padStart(3,'0')+'.bin';fd=fs.openSync(path.join(root,name),'wx',0o600);count=0;partHash=crypto.createHash('sha256');}const end=Math.min(b.length,offset+128*1024**2-count),piece=b.subarray(offset,end);let written=0;while(written<piece.length)written+=fs.writeSync(fd,piece,written,piece.length-written);partHash.update(piece);count+=piece.length;offset=end;if(count===128*1024**2)finish();}}finish();}finally{if(fd!==null)fs.closeSync(fd);}
 assert(total===BYTES&&whole.digest('hex')===asset.ciphertextSha256&&parts.length===6,'SCOPED_CIPHER_PART_IDENTITY');
 const result={schema:'omc-installer-scoped-delivery-v1',originalArtifact:artifact,originalZipSha256:zipSha,
  keyDerivation:{algorithm:'HMAC-SHA256',context:CONTEXT},asset,parts,
  sameInstallerBytes:true,generalTransportKeyExported:false,photosAccessed:false,sourceOrModelRebuilt:false,feeUSD:0};
 fs.writeFileSync(path.join(root,'INDEX.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'PASS_SCOPED_INSTALLER_DELIVERY_CIPHER',sha256:SHA,bytes:BYTES,parts:6,generalKeyExported:false}));
}finally{master.fill(0);scoped.fill(0);}

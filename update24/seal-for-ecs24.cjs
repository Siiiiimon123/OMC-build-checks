'use strict';
const fs=require('node:fs'),path=require('node:path'),c=require('node:crypto'),assert=require('node:assert/strict');
const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'ecs-recipient24.json')));
const pub=c.createPublicKey({key:{kty:cfg.kty,n:cfg.n,e:cfg.e},format:'jwk'});
const sha=b=>c.createHash('sha256').update(b).digest('hex');
assert(sha(pub.export({type:'spki',format:'der'}))===cfg.hash);
const domain=Buffer.from('omc-preview24-ecs-delivery-v1');
const wrap=key=>c.publicEncrypt({key:pub,padding:c.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:domain},key).toString('base64');
const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'../delivery24/BASE20_ARTIFACTS.json')));
const artifactEndpoint='https://api.github.com/repos/Siiiiimon123/OMC-build-checks/actions/artifacts/';
async function main(){
 assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks'
 &&process.env.GITHUB_REF==='refs/heads/verify-update24-ecs-delivery'&&process.env.GITHUB_RUN_ATTEMPT==='1');
 const [action,dir,platform,input]=process.argv.slice(2);
 const work=path.resolve(process.env.RUNNER_TEMP,'omc-update24');
 assert(path.resolve(dir)===work);
 if(action==='seal'){
   const target=spec[platform];assert(target&&path.resolve(input).startsWith(work+path.sep));
   const key=c.randomBytes(32);
   const transport=require(path.join(work,'transport.cjs'));
   const out=path.join(work,platform,'payload.enc');
   try{
     const receipt=await transport.encrypt({input,output:out,id:'preview24-'+platform,key,expectedSha:target.plainSha256,expectedBytes:target.plainBytes});
     fs.writeFileSync(path.join(work,platform,'RECEIPT.json'),JSON.stringify({asset:receipt,key:wrap(key)}),{flag:'wx',mode:0o600});
   }finally{key.fill(0);}
   return;
 }
 assert(action==='locator');
 const token=process.env.GH_TOKEN;assert(token);delete process.env.GH_TOKEN;
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json'};
 const platforms=['windows','mac'];
 const packages=await Promise.all(platforms.map(async platform=>{
   const id=Number(process.env[platform.toUpperCase()+'_ARTIFACT']);
   assert(Number.isSafeInteger(id)&&id>0);
   const r=await fetch(artifactEndpoint+id,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
   assert(r.ok);
   const m=await r.json();
   assert(m.id===id&&!m.expired&&m.name==='omc-preview24-owner-'+platform&&/^sha256:[a-f0-9]{64}$/.test(m.digest));
   const local=JSON.parse(fs.readFileSync(path.join(work,platform,'RECEIPT.json')));
   assert(m.size_in_bytes>=local.asset.ciphertextBytes&&m.size_in_bytes-local.asset.ciphertextBytes<=65536);
   const redirect=await fetch(artifactEndpoint+id+'/zip',{headers,redirect:'manual',signal:AbortSignal.timeout(20000)});
   assert(redirect.status===302);await redirect.body?.cancel();
   const url=new URL(redirect.headers.get('location'));
   assert(url.protocol==='https:'&&/^productionresultssa\d+\.blob\.core\.windows\.net$/.test(url.hostname));
   assert(url.pathname.startsWith('/actions-results/')&&url.searchParams.get('sp')==='r');
   return {platform,id,url:url.href,expires:Date.parse(url.searchParams.get('se')),bytes:m.size_in_bytes,sha256:m.digest.slice(7),...local};
 }));
 const key=c.randomBytes(32),iv=c.randomBytes(12),enc=c.createCipheriv('aes-256-gcm',key,iv);enc.setAAD(domain);
 const cipher=Buffer.concat([enc.update(Buffer.from(JSON.stringify({pub:cfg.hash,packages}))),enc.final()]);
 const envelope={v:1,pub:cfg.hash,key:wrap(key),iv:iv.toString('base64'),tag:enc.getAuthTag().toString('base64'),cipher:cipher.toString('base64')};
 key.fill(0);
 // This line is ciphertext encrypted exclusively to the owner's verified one-time public key.
 console.log('OMC_ECS_SEALED_LOCATORS='+Buffer.from(JSON.stringify(envelope)).toString('base64'));
}
main().catch(e=>{console.error(e.code??e.name);process.exitCode=1;});

'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root='https://api.github.com/repos/Siiiiimon123/OMC-build-checks/actions/artifacts/';
const id=13659837928,sha='1168206edaf13a896d9022c3a5762e1458167eb69886c07f96ebfb187ade7cef',bytes=992022836;
async function main(){
 assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks'
  &&process.env.GITHUB_REF==='refs/heads/verify-update24-mac-resume'&&process.env.GITHUB_RUN_ATTEMPT==='1');
 const token=process.env.GH_TOKEN;
 assert(token);delete process.env.GH_TOKEN;
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json'};
 const r=await fetch(root+id,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
 assert(r.ok);
 const meta=await r.json();assert(meta.id===id&&!meta.expired&&meta.digest==='sha256:'+sha&&meta.size_in_bytes===bytes);
 const d=await fetch(root+id+'/zip',{headers,redirect:'manual',signal:AbortSignal.timeout(10000)});
 assert(d.status===302);await d.body?.cancel();
 const u=new URL(d.headers.get('location'));
 assert(u.protocol==='https:'&&/^productionresultssa\d+\.blob\.core\.windows\.net$/.test(u.hostname));
 assert(u.pathname.startsWith('/actions-results/')&&u.searchParams.get('sp')==='r');
 const expiry=Date.parse(u.searchParams.get('se'));
 assert(expiry>Date.now()&&expiry<Date.now()+20*60*1000);
 const out=path.join(process.env.RUNNER_TEMP,'mac24-resume-reference');
 fs.mkdirSync(out);
 const info=path.join(out,'signed-url.json');
 fs.writeFileSync(info,JSON.stringify({artifact:id,sha256:sha,bytes,url:u.href,expires:expiry}),{flag:'wx',mode:0o600});
 const t=path.resolve('final19/transport.cjs');
 const got=spawnSync(process.execPath,[t,'encrypt','--id','mac24-resume','--input',info,'--output',path.join(out,'ref.enc'),
  '--manifest',path.join(out,'REFERENCE_READY.json')],{stdio:'ignore'});
 fs.unlinkSync(info);assert(got.status===0);
 console.log(JSON.stringify({status:'ENCRYPTED_EXISTING_ARTIFACT_REFERENCE',id,bytes}));
}
main().catch(e=>{console.error(e.code??e.name);process.exitCode=1;});

'use strict';
// Authenticate an existing encrypted report in the same approved Windows VM.
// Public output is restricted to synthetic/anonymous test state, never images.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Readable}=require('node:stream'),{createRequire}=require('node:module');
const [source,transportFile,outputRoot]=process.argv.slice(2);
const JSZip=createRequire(path.join(source,'package.json'))('jszip');
const transport=require(transportFile),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const id=13472856720;
 const response=await fetch(`https://api.github.com/repos/Siiiiimon123/OMC-build-checks/actions/artifacts/${id}/zip`,{
  headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('ARTIFACT_HTTP_'+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length!==1341466||sha(bytes)!=='920a8863db669f116bd225344c9974b038774fce4208ac71d1a2ece6d026b316')throw Error('ARTIFACT_DIGEST');
 const outer=await JSZip.loadAsync(bytes,{checkCRC32:true});
 const manifest=JSON.parse(await outer.file('REPORTS_READY.json').async('string'));
 if(manifest.schema!==transport.SCHEMA||manifest.assets?.length!==1||manifest.assets[0].id!=='r20-reports')throw Error('REPORT_MANIFEST');
 const plain=path.join(outputRoot,'prior-jpeg-race-authenticated.zip');
 await transport.decryptStream(Readable.from(await outer.file('reports.enc').async('nodebuffer')),
  manifest.assets[0],plain,Buffer.from(process.env.OMC_PREVIEW15_TRANSPORT_KEY,'hex'));
 const archive=await JSZip.loadAsync(fs.readFileSync(plain),{checkCRC32:true});
 const frozen=JSON.parse(await archive.file('FROZEN_INPUTS.json').async('string'));
 const reportFile='native-jpeg-race/evidence/JPEG_RACE.json';
 const reportBytes=await archive.file(reportFile).async('nodebuffer');
 const report=JSON.parse(reportBytes);
 if(frozen.sourceTree!=='eefca8d4c620552e3f20bdc09627633710b8a8ce'
  ||frozen.controlCommit!=='310667eb32ab1f23970662d5057deb36991c23c7'
  ||report.sourceTree!==frozen.sourceTree)throw Error('PRIOR_REPORT_SOURCE_IDENTITY');
 const output=path.join(outputRoot,'readout-jpeg-race');fs.mkdirSync(output);
 fs.writeFileSync(path.join(output,'JPEG_RACE.json'),reportBytes,{flag:'wx'});
 fs.writeFileSync(path.join(output,'FROZEN_INPUTS.json'),JSON.stringify(frozen),{flag:'wx'});
 const saved=[];
 for(const name of ['jpeg-race-b-refined.png','jpeg-race-b-reopened.png']){
  const member=archive.file('native-jpeg-race/evidence/'+name);if(!member)continue;
  const data=await member.async('nodebuffer');if(data.length>4*1024**2)throw Error('SCREENSHOT_SIZE_BOUND');
  fs.writeFileSync(path.join(output,name),data,{flag:'wx'});saved.push({name,bytes:data.length,sha256:sha(data)});
 }
 const bFrames=(report.frames??[]).filter(f=>f.photoId===report.bId&&f.quality==='refined'&&f.busy==='false'&&f.saveDisabled===false&&f.sha256);
 const frameChecks=bFrames.map(f=>({at:f.at,ev:f.ev,saturation:f.saturation,texture:f.texture,
  matchingResultCount:(report.calls??[]).filter(c=>c.photoId===report.bId&&c.outcome==='success'&&c.sha256===f.sha256
   &&Math.abs(c.recipe.exposureEv-f.ev)<.001&&Math.abs((c.recipe.saturationFactor??1)*100-f.saturation)<.001
   &&Math.abs((c.recipe.textureAmount??0)-f.texture)<.001).length}));
 const code=String(report.error??'').match(/^Error: ([A-Z][A-Z0-9_:]*)/)?.[1]??null;
 const stage=/^[a-z0-9_-]{1,80}$/.test(report.failedStage??'')?report.failedStage:null;
 const receipt={artifact:id,outerBytes:bytes.length,outerSha256:sha(bytes),authenticated:true,
  sourceTree:frozen.sourceTree,controlCommit:frozen.controlCommit,reportSha256:sha(reportBytes),screenshots:saved,
  resultStatus:/^[A-Z_]{1,120}$/.test(report.status??'')?report.status:'UNRECOGNIZED',failedStage:stage,errorCode:code,
  pendingAObserved:report.pendingAObserved===true,overlapStatus:report.overlap?.status??'NOT_REPORTED',
  successfulLateAResultObserved:report.overlap?.successfulLateResultObserved??null,
  bReopened:report.bReopened?{ev:report.bReopened.ev,saturation:report.bReopened.saturation,texture:report.bReopened.texture}:null,
  bFrameChecks:frameChecks,originalsUnchanged:report.originalsUnchanged===true};
 fs.writeFileSync(path.join(output,'READOUT_RECEIPT.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
 console.log(JSON.stringify(receipt));
})().catch(error=>{console.error(JSON.stringify({readoutFailed:true,errorCode:/^[A-Z0-9_:]+$/.test(error.message)?error.message:error.name}));process.exitCode=1;});

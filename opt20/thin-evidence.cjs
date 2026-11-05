'use strict';
// Read existing encrypted evidence; never rerun the product or publish plaintext.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Readable}=require('node:stream'),{createRequire}=require('node:module');
const [source,transportFile,configFile,outputRoot]=process.argv.slice(2);
const JSZip=createRequire(path.join(source,'package.json'))('jszip');
const transport=require(transportFile),rows=JSON.parse(fs.readFileSync(configFile,'utf8'));
const key=Buffer.from(process.env.OMC_PREVIEW15_TRANSPORT_KEY,'hex');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function extract(row){
 if(!Number.isSafeInteger(row.id)||row.bytes<1||row.bytes>512*1024**2||!['windows','mac'].includes(row.platform))throw Error('INVALID_READOUT_SCOPE');
 const response=await fetch(`https://api.github.com/repos/Siiiiimon123/OMC-build-checks/actions/artifacts/${row.id}/zip`,{
  headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(180000)});
 if(!response.ok)throw Error('ARTIFACT_HTTP_'+response.status);
 const outerBytes=Buffer.from(await response.arrayBuffer());
 if(outerBytes.length!==row.bytes||sha(outerBytes)!==row.sha256)throw Error('ARTIFACT_DIGEST_MISMATCH');
 const outer=await JSZip.loadAsync(outerBytes,{checkCRC32:true});
 const manifest=JSON.parse(await outer.file('REPORTS_READY.json').async('string'));
 if(manifest.schema!==transport.SCHEMA||manifest.assets?.length!==1||manifest.assets[0].id!=='r20-reports')throw Error('REPORT_MANIFEST_MISMATCH');
 const cipher=await outer.file('reports.enc').async('nodebuffer');
 const plainZip=path.join(outputRoot,`readout-${row.platform}.zip`);
 await transport.decryptStream(Readable.from(cipher),manifest.assets[0],plainZip,key);
 const archive=await JSZip.loadAsync(fs.readFileSync(plainZip),{checkCRC32:true});
 const target=path.join(outputRoot,'readout-'+row.platform);fs.mkdirSync(target,{recursive:false});
 let total=0;const selected=[];
 for(const [name,file] of Object.entries(archive.files)){
  const text=/^(?:native-(?:sample-a|sample-b|synthetic|stress)\/evidence\/[^/]+\.json|[A-Za-z0-9_-]+\.(?:json|log))$/.test(name);
  const image=['native-sample-a/evidence/initial-refined.png','native-synthetic/evidence/initial-refined.png'].includes(name);
  if(file.dir||(!text&&!image))continue;
  const data=await file.async('nodebuffer');
  if(data.length>8*1024**2||(total+=data.length)>24*1024**2)throw Error('THIN_REPORT_BUDGET');
  const dest=path.join(target,...name.split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data,{flag:'wx'});
  selected.push({path:name,bytes:data.length,sha256:sha(data)});
 }
 fs.writeFileSync(path.join(target,'READOUT_RECEIPT.json'),JSON.stringify({originalArtifact:row,
  originalEncryptedArtifactPreserved:true,authenticated:true,selectedBytes:total,selected,
  excluded:'App profiles, original/linked fixtures, generated exports and duplicate screenshots'},null,2));
 // Only this disposable cloud readout's authenticated temporary ZIP. The full
 // original artifact and its digest remain the keeper; no historical deletion.
 fs.unlinkSync(plainZip);
 console.log(JSON.stringify({artifact:row.id,selectedFiles:selected.length,selectedBytes:total,authenticated:true}));
}
(async()=>{for(const row of rows)await extract(row);})().catch(error=>{console.error(error.name,error.message);process.exitCode=1;});
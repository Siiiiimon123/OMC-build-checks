// Generic synthetic RGB differential/benchmark. No photographs or model data.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [source,baselineFile,output]=process.argv.slice(2);
const hash=b=>createHash('sha256').update(b).digest('hex');
const before=fs.readFileSync(baselineFile);
assert.equal(hash(before),'a00824bd4c90614c5f88cb3f66449c7517fdd320155a0879eda38ee2b09bcdac');
const recipePath=path.join(source,'src/services/jpegEditRecipe.js');
assert.equal(hash(fs.readFileSync(recipePath)),'e53f8e7ab8ca0c908da046879fb2e0c65ccb45b79f05913a7ab828b4b6a2baf1');
const referenceCode=before.toString('utf8').replace('"./jpegEditRecipe.js"',JSON.stringify(pathToFileURL(recipePath).href));
assert.notEqual(referenceCode,before.toString('utf8'));
const reference=await import('data:text/javascript;base64,'+Buffer.from(referenceCode).toString('base64'));
const candidate=await import(pathToFileURL(path.join(source,'src/services/jpegSaturation.js')).href);
const report={schema:'omc-saturation-byte-exact-optimization-v1',syntheticOnly:true,
  baselineSha256:hash(before),candidateSha256:hash(fs.readFileSync(path.join(source,'src/services/jpegSaturation.js'))),
  sourceRecipeSha256:hash(fs.readFileSync(recipePath)),fullRgbCases:[],benchmark:[]};
function run(module,input,ev,saturation){const data=input.slice(),kernel=module.createJpegSaturationKernel(ev,saturation);
  const start=performance.now(),diagnostics=module.applyJpegSaturationRgbaRange(data,kernel);
  return{data,diagnostics,ms:performance.now()-start};}
function compare(a,b){assert.equal(Buffer.compare(Buffer.from(a.data.buffer,a.data.byteOffset,a.data.byteLength),Buffer.from(b.data.buffer,b.data.byteOffset,b.data.byteLength)),0,'BYTE_DIFFERENCE');assert.deepEqual(a.diagnostics,b.diagnostics,'DIAGNOSTIC_DIFFERENCE');}
const rgb=new Uint8ClampedArray(256**3*4);
for(let colour=0;colour<256**3;colour++){const p=colour*4;rgb[p]=colour>>>16;rgb[p+1]=(colour>>>8)&255;rgb[p+2]=colour&255;rgb[p+3]=255;}
for(const [ev,saturation] of [[.6,1.15],[-.4,1.1]]){
 const old=run(reference,rgb,ev,saturation),next=run(candidate,rgb,ev,saturation);compare(old,next);
 report.fullRgbCases.push({ev,saturation,pixels:256**3,bytesEqual:true,diagnosticsEqual:true,
   outputSha256:hash(next.data),diagnostics:next.diagnostics});
}
const sample=new Uint8ClampedArray(1024*1024*4);let seed=0x1987f007;
for(let p=0;p<sample.length;p+=4){for(let c=0;c<3;c++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;sample[p+c]=seed>>>24;}sample[p+3]=255;}
for(const [ev,saturation] of [[.6,1.15],[-.4,1.1]]){
 run(reference,sample.subarray(0,65536*4),ev,saturation);run(candidate,sample.subarray(0,65536*4),ev,saturation);
 const rows=[];let expectedHash=null,expectedDiagnostics=null;
 for(const [name,module] of [['reference',reference],['candidate',candidate],['candidate',candidate],['reference',reference]]){
  const r=run(module,sample,ev,saturation),sha=hash(r.data);if(expectedHash===null){expectedHash=sha;expectedDiagnostics=r.diagnostics;}
  assert.equal(sha,expectedHash);assert.deepEqual(r.diagnostics,expectedDiagnostics);rows.push({name,ms:r.ms});
 }
 const sum=name=>rows.filter(r=>r.name===name).reduce((n,r)=>n+r.ms,0);
 report.benchmark.push({ev,saturation,pixels:sample.length/4,order:'ABBA',rows,
   sameBytesAndDiagnostics:true,referenceTotalMs:sum('reference'),candidateTotalMs:sum('candidate'),
   kernelSpeedup:sum('reference')/sum('candidate')});
}
report.status='PASS_EXACT_RGB_DIFFERENTIAL';report.limits=['Synthetic CPU kernel only','Not complete JPEG decode/encode or GUI latency','No GPU or real thousand-photo qualification'];
fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({status:report.status,allRgbPixelsPerRecipe:256**3,recipes:report.fullRgbCases.length,
  candidateSha256:report.candidateSha256,kernelSpeedups:report.benchmark.map(r=>r.kernelSpeedup)}));

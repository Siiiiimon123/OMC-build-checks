// Frozen production-before/after comparison; no photo or model inference.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [source,baselineFile,output]=process.argv.slice(2);
const text=fs.readFileSync(baselineFile,'utf8');
const match=text.match(/export function hammingDistance\([\s\S]*?\n\}/);
if(!match)throw Error('FROZEN_BASELINE_FUNCTION_MISSING');
const before=vm.runInNewContext('('+match[0].replace(/^export /,'')+')');
const {hammingDistance:after}=await import(pathToFileURL(path.join(source,'src/services/imageAnalyzer.js')).href);
let seed=17n;const hashes=Array.from({length:1000},()=>{
 seed=BigInt.asUintN(64,seed*6364136223846793005n+1442695040888963407n);return seed.toString(16).padStart(16,'0');
});
function run(fn){const start=performance.now();let checksum=0;
 for(let i=0;i<hashes.length;i++)for(let j=i+1;j<hashes.length;j++)checksum+=fn(hashes[i],hashes[j]);
 return{ms:performance.now()-start,checksum};
}
for(let i=0;i<5000;i++){before(hashes[i%1000],hashes[(i+31)%1000]);after(hashes[i%1000],hashes[(i+31)%1000]);}
const beforeRuns=[],afterRuns=[];
for(let trial=0;trial<3;trial++){
 const a=trial%2?null:run(before),b=run(after),c=a??run(before);
 if(c.checksum!==b.checksum)throw Error('GROUPING_DISTANCE_CHECKSUM_CHANGED');beforeRuns.push(c);afterRuns.push(b);
}
const median=rows=>rows.map(r=>r.ms).sort((a,b)=>a-b)[1];
fs.writeFileSync(output,JSON.stringify({status:'PASS_EXACT_KERNEL_COMPARISON',hashes:1000,pairsPerTrial:499500,
 beforeRuns,afterRuns,beforeMedianMs:median(beforeRuns),afterMedianMs:median(afterRuns),
 medianSpeedRatio:median(beforeRuns)/median(afterRuns),
 limitations:['Synthetic hash distances, not real-photo import, full grouping or AI/GPU throughput','Same free Windows VM; timing is host dependent']},null,2));
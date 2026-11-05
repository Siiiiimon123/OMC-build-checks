// Test the actual driver evaluation helper before starting the product. Cloud only.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
if(process.env.GITHUB_ACTIONS!=='true')throw Error('CLOUD_ONLY');
const text=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'cloud-jpeg.mjs'),'utf8');
const line=text.split(/\r?\n/).find(x=>x.startsWith('async function ev(expression)'));
assert(line);
const call=async(method,options)=>{
 assert.equal(method,'Runtime.evaluate');assert.equal(options.awaitPromise,true);
 try{return{result:{value:await new vm.Script(options.expression).runInNewContext({document:{querySelector:()=>null}})}};}
 catch(e){return{exceptionDetails:{message:e.message}};}
};
const evaluate=new vm.Script('('+line+')').runInNewContext({call});
assert.equal(await evaluate('Boolean(await Promise.resolve(true))'),true);
assert.equal(await evaluate('Boolean(await (document.querySelector("missing")?.complete))'),false);
assert.equal(await evaluate('({a:1})').then(x=>x.a),1);
await assert.rejects(evaluate('(()=>{throw Error("expected")})()'),/RENDERER_EVAL/);
let parsed=0;
for(const match of text.matchAll(/(?:ev|until)\((('(?:\\.|[^'\\])*')|("(?:\\.|[^"\\])*")|(`(?:\\.|[^`\\])*`))(?=\s*[,)])/g)){
 const expression=new vm.Script(match[1]).runInNewContext();
 new vm.Script('(async()=>{return ('+expression+');})()');parsed++;
}
assert(parsed>=15);
console.log('PASS: actual CDP helper and '+parsed+' embedded expressions parsed; async, missing elements and errors handled');

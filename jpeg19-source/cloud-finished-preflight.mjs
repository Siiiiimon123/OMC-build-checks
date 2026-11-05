// Test the actual driver evaluation helper before starting the product. Cloud only.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installExportPicker,installImportPicker} from './cloud-finished-flow.mjs';
if(process.env.GITHUB_ACTIONS!=='true')throw Error('CLOUD_ONLY');
const text=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'cloud-finished-run.mjs'),'utf8');
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
 if(match[1].startsWith('`')&&match[1].includes('${'))continue;
 const expression=new vm.Script(match[1]).runInNewContext();
 new vm.Script('(async()=>{return ('+expression+');})()');parsed++;
}
assert(parsed>=15);
const clickLine=text.split(/\r?\n/).find(x=>x.startsWith('async function click(text)'));
let readyObserved=false;
const click=new vm.Script('('+clickLine+')').runInNewContext({assert:(v,m)=>assert(v,m),until:async expression=>{new vm.Script('(async()=>('+expression+'))()');readyObserved=true;},ev:async expression=>{assert(readyObserved,'Clicks must wait for enabled controls');new vm.Script('(async()=>('+expression+'))()');return true;}});
await click('cloud "quoted" label');
const dialog={};
const installer=new vm.Script('('+installExportPicker.toString()+')').runInNewContext({process:{mainModule:{require:name=>{assert.equal(name,'electron');return{dialog};}}}});
assert.equal(installer('/cloud-output'),true);
assert.deepEqual(JSON.parse(JSON.stringify(await dialog.showOpenDialog({}, {title:'选择导出位置',properties:['openDirectory']}))),{canceled:false,filePaths:['/cloud-output']});
await assert.rejects(dialog.showOpenDialog({}, {title:'Other',properties:['openDirectory']}),/UNREVIEWED_PICKER/);
await assert.rejects(dialog.showOpenDialog({}, {title:'选择导出位置',properties:['openFile']}),/UNREVIEWED_PICKER/);
const importInstaller=new vm.Script('('+installImportPicker.toString()+')').runInNewContext({process:{mainModule:{require:name=>{assert.equal(name,'electron');return{dialog};}}}});
assert.equal(importInstaller(['/fixture-a.jpg','/fixture-b.jpg']),true);
assert.deepEqual(JSON.parse(JSON.stringify(await dialog.showOpenDialog({}, {title:'选择照片文件',properties:['openFile','multiSelections']}))),{canceled:false,filePaths:['/fixture-a.jpg','/fixture-b.jpg']});
await assert.rejects(dialog.showOpenDialog({}, {title:'选择照片文件夹',properties:['openDirectory']}),/UNREVIEWED_IMPORT_PICKER/);
await assert.rejects(dialog.showOpenDialog({}, {title:'选择照片文件',properties:['openFile','multiSelections','openDirectory']}),/UNREVIEWED_IMPORT_PICKER/);
assert.throws(()=>importInstaller([]),/IMPORT_FIXTURE_PATHS/);
assert(!text.includes('DOM.setFileInputFiles'),'Desktop import must create real IPC source grants');
console.log('PASS: actual CDP helper and '+parsed+' embedded expressions parsed; async, missing elements and errors handled');

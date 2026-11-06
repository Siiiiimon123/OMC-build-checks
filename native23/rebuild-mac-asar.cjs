'use strict';
// Update current app code only. The accepted Python/runtime closure stays intact.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const C=require('./contracts.cjs');
async function main(){
 assert(process.env.GITHUB_ACTIONS==='true'&&process.platform==='darwin');
 const [source,app,inputs,work,reports]=process.argv.slice(2),req=createRequire(path.join(source,'package.json')),asar=req('@electron/asar');
 const read=p=>JSON.parse(fs.readFileSync(p)),manifest=read(path.join(inputs,'source19-records.json'));
 assert(manifest.sourceTree==='be3c2093a1bc62ea5755f8ed49326186be980e5e'&&manifest.records.length===946);
 await C.verifyRows(source,manifest.records);
 const staged=path.join(work,'asar-input');asar.extractAll(path.join(app,'Contents/Resources/app.asar'),staged);
 const old=read(path.join(staged,'package.json')),current=read(path.join(source,'package.json'));
 assert(old.version==='1.0.21-preview.22'&&current.version==='1.0.21-preview.23');assert.deepEqual(old.dependencies,current.dependencies);
 const face=read(path.join(source,'contracts/frontend-face-runtime-v1.json'));
 for(const row of face.assets){const before=C.plain(staged,row.path.replace(/^public\//,'dist/')),dest=path.join(source,row.path);assert(fs.statSync(before).size===row.sizeBytes&&C.sha(fs.readFileSync(before))===row.sha256);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(before,dest);}
 execFileSync(process.execPath,[path.join(__dirname,'provision-subject-model.cjs'),source,reports],{stdio:'inherit'});
 execFileSync(process.execPath,[path.join(source,'node_modules/vite/bin/vite.js'),'build'],{cwd:source,stdio:'inherit'});
 await C.verifyRows(source,manifest.records);
 const metadata=read(path.join(source,'dist/release-metadata.json'));
 assert(metadata.version===current.version);metadata.releaseCapabilities.releaseProfileId='MAC_ARM64_PREVIEW_WARNING_ONLY';metadata.releaseCapabilities.platform='darwin';metadata.releaseCapabilities.arch='arm64';
 const prior=C.sha(fs.readFileSync(path.join(source,'dist/release-metadata.json')));
 fs.writeFileSync(path.join(source,'dist/release-metadata.json'),JSON.stringify(metadata,null,2)+'\n');
 for(const folder of ['dist','electron','contracts','licenses']){const dest=path.join(staged,folder);C.beneath(work,dest);fs.rmSync(dest,{recursive:true,force:true});fs.cpSync(path.join(source,folder),dest,{recursive:true,errorOnExist:true,force:false});}
 for(const file of ['LICENSE','PREVIEW_LICENSE.txt','THIRD_PARTY_NOTICES.md','package.json'])fs.copyFileSync(C.plain(source,file),path.join(staged,file));
 const subject=read(path.join(source,'contracts/frontend-subject-runtime-v1.json')).asset;
 await C.verifyRows(staged,[{path:subject.path.replace(/^public\//,'dist/'),bytes:subject.sizeBytes,sha256:subject.sha256}]);
 const rows=[];for(const file of C.files(staged))rows.push(await C.inspect(staged,file));
 const next=path.join(work,'current-app.asar');await asar.createPackage(staged,next);
 for(const row of rows){const bytes=asar.extractFile(next,row.path);assert(bytes.length===row.bytes&&C.sha(bytes)===row.sha256,'ASAR_READBACK:'+row.path);}
 fs.copyFileSync(next,path.join(app,'Contents/Resources/app.asar'));
 fs.writeFileSync(path.join(reports,'FRONTEND_REBUILD.json'),JSON.stringify({status:'PASS',sourceTree:manifest.sourceTree,sourceFiles:946,priorVersion:old.version,version:current.version,dependencyRangesUnchanged:true,backendRebuilt:false,sourceFilesUnchanged:true,macMetadataDerivation:{path:'dist/release-metadata.json',beforeSha256:prior,afterSha256:C.sha(fs.readFileSync(path.join(staged,'dist/release-metadata.json')))},asarSha256:C.sha(fs.readFileSync(next)),asarHeaderSha256:C.sha(Buffer.from(asar.getRawHeader(next).headerString)),memberCount:rows.length})+'\n',{flag:'wx'});
}
main().catch(e=>{console.error(String(e.stack??e));process.exitCode=1;});

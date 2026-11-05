'use strict';
// Cloud assembly only. Install/AI/upgrade acceptance remains a separate gate.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');
const C = require('./contracts.cjs');
const bootstrap = require('./bootstrap.cjs');
const SOURCE_TREE = '1e39b9ae2921480b27d4a1a8bf5f8499004886fa';
const BASE = {bytes:827849039,sha256:'d59c5e92eea29251702c8e06038e616e78e10604f6863f39309af932a543c8fd'};
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2)+'\n', {flag:'wx'});

function members(raw) {
  const marker = /\r?\n----------\r?\n/.exec(raw);
  assert(marker, '7Z_MEMBER_SEPARATOR');
  const rows = raw.slice(marker.index+marker[0].length).trim().split(/\r?\n\r?\n/).map(block =>
    Object.fromEntries(block.split(/\r?\n/).filter(line => line.includes(' = ')).map(line => {
      const i = line.indexOf(' = '); return [line.slice(0,i),line.slice(i+3)];
    }))).filter(row => row.Path && !row.Attributes?.includes('D'));
  for (const row of rows) {
    row.path = row.Path.replaceAll('\\','/'); C.rel(row.path);
    assert(!row['Symbolic Link'] && !row['Hard Link'], 'ARCHIVE_LINK');
  }
  C.map(rows.map(row => ({path:row.path,bytes:Number(row.Size),sha256:'0'.repeat(64)})));
  return rows;
}

async function main() {
  assert(process.env.GITHUB_ACTIONS==='true' && process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks');
  assert(process.env.GITHUB_RUN_ATTEMPT==='1' && process.env.GITHUB_REF==='refs/heads/verify-final-package19');
  assert(process.platform==='win32' && process.arch==='x64');
  const args = process.argv.slice(2);
  assert(args.length===12, 'SIX_EXACT_ARGUMENT_PAIRS');
  const o = Object.fromEntries(Array.from({length:6},(_,i)=>[args[2*i].replace(/^--/,''),args[2*i+1]]));
  assert.deepEqual(Object.keys(o).sort(), ['base','inputs','python','resources','source','work']);
  const temp = path.resolve(process.env.RUNNER_TEMP);
  const source = C.beneath(temp,o.source), base=C.beneath(temp,o.base), work=C.beneath(temp,o.work);
  const inputs = C.beneath(temp,o.inputs), resources=C.beneath(temp,o.resources);
  assert(!fs.existsSync(work), 'FRESH_WORK_REQUIRED');
  const manifest=read(path.join(inputs,'source19-records.json'));
  assert(manifest.sourceTree===SOURCE_TREE && manifest.records.length===932);
  await C.verifyRows(source,manifest.records);
  assert.equal(C.gitTree(manifest.records),SOURCE_TREE);
  await C.verifyRows(temp,[{path:path.relative(temp,base).replaceAll('\\','/'),...BASE}]);
  const req=createRequire(path.join(source,'package.json'));
  assert.equal(req('electron-builder/package.json').version,'26.15.3');
  const asar=req('@electron/asar'), verification=req('./electron/installerVerification.cjs');
  const extractor=await bootstrap.getApprovedExtractor(req,verification), seven=extractor.executable;
  verification.assertNsisInstallerExecutable(base);
  fs.mkdirSync(work);
  const reports=path.join(work,'reports');fs.mkdirSync(reports);
  const result={schema:'omc-final-windows-build-v1',status:'RUNNING',baselineSourceTree:SOURCE_TREE,
    version:'1.0.21-preview.19',releaseAccepted:false,installerExecuted:false,fullAiAccepted:false};
  const env={...process.env};
  for (const name of ['OMC_PREVIEW15_TRANSPORT_KEY','GITHUB_TOKEN','GH_TOKEN']) delete env[name];
  const command=(label,exe,argv,options={})=>{
    console.log(JSON.stringify({phase:label,at:new Date().toISOString()}));
    const log=fs.openSync(path.join(reports,label+'.log'),'wx');
    try{return execFileSync(exe,argv,{cwd:source,env,windowsHide:true,stdio:['ignore',log,log],timeout:900000,...options});}
    finally{fs.closeSync(log);}
  };
  const sevenRun=argv=>execFileSync(seven,argv,{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});
  try {
    sevenRun(['t','-t7z','-bd','-bb0',base]);
    const baseRows=bootstrap.directAppMembers(members(sevenRun(['l','-slt','-t7z','-sccUTF-8',base])));
    const app=path.join(work,'fullApp');fs.mkdirSync(app);
    sevenRun(['x','-t7z','-y','-bd','-bb0','-o'+app,base]);
    assert.deepEqual(C.files(app),baseRows.map(row=>row.path).sort());
    const before=[];for(const file of C.files(app))before.push(await C.inspect(app,file));
    save(path.join(reports,'BASE_APP_MEMBERS.json'),before);
    const input=path.join(work,'asar-input');asar.extractAll(path.join(app,'resources/app.asar'),input);
    // Stage only the seven existing byte-bound face assets before Vite. AI's
    // much larger public/models inputs are linked only after Vite finishes.
    const face=read(path.join(source,'contracts/frontend-face-runtime-v1.json'));
    for(const row of face.assets){
      const name=row.path.replace(/^public\//,'dist/');
      const old=C.plain(input,name), target=path.join(source,...row.path.split('/'));
      assert.equal(fs.statSync(old).size,row.sizeBytes);assert.equal(C.sha(fs.readFileSync(old)),row.sha256);
      fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(old,target);
    }
    command('vite-current-source',process.execPath,[path.join(source,'node_modules/vite/bin/vite.js'),'build']);
    await C.verifyRows(source,manifest.records);
    const runtime=path.join(app,'resources/ai-service');
    command('current-ai-entry-rebuild',o.python,['-B',path.join(__dirname,'cloud-final-windows-backend.py'),
      '--source',source,'--runtime',runtime,'--candidate-inputs',path.join(inputs,'AI_ENTRY_REBUILD_INPUTS.json'),
      '--resource-tar',resources,'--reports',reports,'--work',path.join(work,'backend-build')]);
    const runtimeProof=req('./electron/releaseInputs.cjs').verifyApprovedAiRuntime({runtimeRoot:runtime,
      approvedRuntimePath:path.join(source,'ai-training/approved-ai-runtime.json'),expectedTarget:'windows-x64'});
    save(path.join(reports,'ACTUAL_RUNTIME_VERIFICATION.json'),runtimeProof);
    // Replace current application trees, preserving base node_modules exactly.
    const replaced=['dist','electron','contracts','licenses'];
    for(const name of replaced){
      const target=path.join(input,name);C.beneath(work,target);
      fs.rmSync(target,{recursive:true,force:true});
      fs.cpSync(path.join(source,name),target,{recursive:true,errorOnExist:true,force:false});
    }
    for(const name of ['LICENSE','PREVIEW_LICENSE.txt','THIRD_PARTY_NOTICES.md','package.json'])
      fs.copyFileSync(C.plain(source,name),path.join(input,name));
    const packageMetadata=read(path.join(input,'package.json'));
    assert.equal(packageMetadata.version,result.version);
    assert(packageMetadata.omcMemberRedistributionCleared!==true,'DO_NOT_FABRICATE_RELEASE_APPROVAL');
    packageMetadata.omcMemberRedistributionCleared=false;
    fs.writeFileSync(path.join(input,'package.json'),JSON.stringify(packageMetadata,null,2)+'\n');
    save(path.join(reports,'PACKAGING_METADATA_DERIVATION.json'),{
      sourcePackageSha256:C.sha(fs.readFileSync(path.join(source,'package.json'))),
      packagedPackageSha256:C.sha(fs.readFileSync(path.join(input,'package.json'))),
      changedField:'omcMemberRedistributionCleared',value:false,
      meaning:'Missing baseline field explicitly recorded as no release approval; frozen source package unchanged'});
    for(const row of face.assets)await C.verifyRows(input,[{path:row.path.replace(/^public\//,'dist/'),bytes:row.sizeBytes,sha256:row.sha256}]);
    const expected=[];for(const file of C.files(input))expected.push(await C.inspect(input,file));
    const newAsar=path.join(work,'new-app.asar');await asar.createPackage(input,newAsar);
    const actualNames=asar.listPackage(newAsar).map(n=>n.replace(/^[/\\]/,'').replaceAll('\\','/'))
      .filter(n=>!asar.statFile(newAsar,path.join(...n.split('/'))).files).sort();
    assert.deepEqual(actualNames,expected.map(row=>row.path).sort());
    for(const row of expected){const b=asar.extractFile(newAsar,path.join(...row.path.split('/')));assert(b.length===row.bytes&&C.sha(b)===row.sha256,'ASAR_READBACK:'+row.path);}
    fs.copyFileSync(newAsar,path.join(app,'resources/app.asar'));
    for(const row of before.filter(row=>row.path!=='resources/app.asar'&&!row.path.startsWith('resources/ai-service/')))await C.verifyRows(app,[row]);
    // Record the real derived source identity; the two regenerated binding
    // manifests must not be passed off as unchanged baseline 1e39.
    const derived=[];for(const row of manifest.records)derived.push({...await C.inspect(source,row.path,true),mode:row.mode});
    const oldBy=new Map(manifest.records.map(row=>[row.path,row]));
    const delta=derived.filter(row=>row.sha256!==oldBy.get(row.path).sha256);
    assert.deepEqual(delta.map(row=>row.path).sort(),['ai-training/ai-service-build-inputs.json','ai-training/approved-ai-runtime.json']);
    save(path.join(reports,'DERIVED_SOURCE_BINDING.json'),{baselineTree:SOURCE_TREE,derivedTree:C.gitTree(derived),delta,records:derived});
    const nsis=path.join(work,'nsis');fs.mkdirSync(nsis);
    const packaging=read(path.join(inputs,'PACKAGING_INPUTS.json'));
    await C.verifyRows(path.join(inputs,'packaging'),packaging.records);
    assert.deepEqual(packaging.records.map(row=>row.path).sort(),['base-reliability.nsh','installer-adapter.nsh','shortcut-binding.nsh']);
    for(const row of packaging.records)fs.copyFileSync(C.plain(path.join(inputs,'packaging'),row.path),path.join(nsis,row.path));
    const adapter=path.join(nsis,'installer-adapter.nsh'),lines=fs.readFileSync(adapter,'utf8').split(/\r?\n/);
    assert(/^!include ".*base-reliability\.nsh"$/.test(lines[0])&&/^!include ".*shortcut-binding\.nsh"$/.test(lines[1]));
    lines[0]=`!include "${path.join(nsis,'base-reliability.nsh')}"`;lines[1]=`!include "${path.join(nsis,'shortcut-binding.nsh')}"`;
    fs.writeFileSync(adapter,lines.join('\n'));
    result.nsisFallback=req('./scripts/electronBuilderNsisUpdateFallback.cjs').applyElectronBuilderNsisUpdateFallback(source);
    const project=path.join(work,'project');fs.mkdirSync(project);save(path.join(project,'package.json'),packageMetadata);
    const out=path.join(work,'artifacts'),config=structuredClone(read(path.join(source,'package.json')).build);
    Object.assign(config,{executableName:'OMC-Photo-Select',electronVersion:'42.11.10',npmRebuild:false,
      buildDependenciesFromSource:false,publish:null,compression:'normal',afterSign:null,afterAllArtifactBuild:null,
      directories:{output:out,buildResources:path.join(source,'public')}});
    Object.assign(config.win,{icon:C.plain(source,'public/icon.ico'),signAndEditExecutable:false,target:[{target:'nsis',arch:['x64']}]});
    Object.assign(config.nsis,{include:adapter,license:C.plain(source,'PREVIEW_LICENSE.txt'),perMachine:false,
      allowElevation:false,deleteAppDataOnUninstall:false,packElevateHelper:false,differentialPackage:false});
    process.env.CSC_IDENTITY_AUTO_DISCOVERY='false';process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL='3';
    await req('app-builder-lib/out/util/config/config').validateConfiguration(config,{debug(){},info(){},warn(){},error(){}});
    const payload=[];for(const file of C.files(app))payload.push(await C.inspect(app,file));
    const {build,Platform,Arch}=req('electron-builder');
    const artifacts=await build({projectDir:project,prepackaged:app,targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),config,publish:'never'});
    assert.equal(artifacts.length,1);await C.exactTree(app,payload);
    const installer=C.beneath(out,artifacts[0]);verification.assertNsisInstallerExecutable(installer);
    sevenRun(['t','-t7z','-bd','-bb0',installer]);
    const packed=members(sevenRun(['l','-slt','-t7z','-sccUTF-8',installer]));assert.equal(packed.length,payload.length);
    const by=new Map(packed.map(row=>[row.path,row]));
    for(const row of payload){const actual=by.get(row.path);assert(actual&&Number(actual.Size)===row.bytes,'INSTALLER_SIZE:'+row.path);
      let crc=0;for await(const b of fs.createReadStream(C.plain(app,row.path)))crc=zlib.crc32(b,crc);
      assert.equal(crc.toString(16).padStart(8,'0'),String(actual.CRC||(row.bytes===0?'00000000':'')).toLowerCase(),'INSTALLER_CRC:'+row.path);}
    const file=await C.inspect(out,path.relative(out,installer).replaceAll('\\','/'));
    const current={version:result.version,path:installer,bytes:file.bytes,sha256:file.sha256,
      asarSha256:(await C.inspect(app,'resources/app.asar')).sha256,
      exeSha256:(await C.inspect(app,'OMC-Photo-Select.exe')).sha256,
      backendSha256:runtimeProof.executableSha256,runtimeTreeSha256:runtimeProof.tree.sha256};
    save(path.join(reports,'FINAL_APP_MEMBERS.json'),payload);
    save(path.join(reports,'PACKAGE_INPUTS.json'),{schema:'omc-final-install-acceptance-input-v1',current,
      base:{version:'1.0.21-preview.18',path:base,...BASE},baselineSourceTree:SOURCE_TREE,derivedSourceTree:C.gitTree(derived)});
    Object.assign(result,{status:'PASS_BUILD_PENDING_INSTALL_AI_UPGRADE',current,fullApp:app});
  } catch(error){result.status='FAIL';result.error=String(error.message).slice(0,2000);throw error;}
  finally{save(path.join(reports,'BUILD_RESULT.json'),result);}
}
if(require.main===module)main().catch(error=>{console.error(String(error.message).slice(0,2000));process.exitCode=1;});

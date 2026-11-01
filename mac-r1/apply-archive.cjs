// Generic archive overlay: no product source is embedded in this public tool.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const asar=require('@electron/asar');
const [app,overlay,version,mode,work]=process.argv.slice(2);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const archive=path.join(app,'Contents/Resources/app.asar'),root=path.join(work,'archive-'+mode);
 const original=asar.getRawHeader(archive).header,unpacked=[];
 function walk(node,p=''){for(const [name,row] of Object.entries(node.files??{})){const n=p?p+'/'+name:name;if(row.files)walk(row,n);else if(row.unpacked){if(/[{},\[\]]/.test(n))throw Error('UNPACK_PATTERN_UNSUPPORTED');unpacked.push(n);}}}
 walk(original);asar.extractAll(archive,root);
 const rows=JSON.parse(fs.readFileSync(path.join(overlay,'OVERLAY.json'))).files;
 const assets=path.join(root,'dist/assets');if(fs.existsSync(assets))fs.rmSync(assets,{recursive:true});
 for(const row of rows){
  if(!/^(?:electron\/[^/]+\.cjs|dist\/.+|package\.json)$/.test(row.path)||row.path.split('/').includes('..'))throw Error('OVERLAY_PATH_INVALID');
  const bytes=fs.readFileSync(path.join(overlay,'app',row.path));if(sha(bytes)!==row.sha256||bytes.length!==row.bytes)throw Error('OVERLAY_BYTES_MISMATCH');
  const dest=path.join(root,...row.path.split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
 }
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));pkg.version=version;fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg,null,2));
 const metaPath=path.join(root,'dist/release-metadata.json'),meta=JSON.parse(fs.readFileSync(metaPath));meta.version=version;fs.writeFileSync(metaPath,JSON.stringify(meta,null,2));
 if(mode==='qa'){
  const c=path.join(root,'contracts/update-client-v1.json'),config=JSON.parse(fs.readFileSync(c));
  if(config.metadataBaseUrl!=='https://omc.xiaoa.cyou/updates/metadata/'||config.targetBaseUrl!=='https://omc.xiaoa.cyou/updates/targets/')throw Error('BASE_UPDATE_ENDPOINT_CHANGED');
  config.metadataBaseUrl='https://omc.xiaoa.cyou/updates/qa/metadata/';config.targetBaseUrl='https://omc.xiaoa.cyou/updates/qa/targets/';fs.writeFileSync(c,JSON.stringify(config,null,2));
 }
 // asar 3.4.1 matches unpack against absolute filenames, not the relative
 // archive member path. Preserve the original unpacked native members.
 const patterns=unpacked.map(n=>'**/'+n);
 const next=path.join(work,'next-'+mode+'.asar');await asar.createPackageWithOptions(root,next,patterns.length?{unpack:patterns.length===1?patterns[0]:'{'+patterns.join(',')+'}'}:{});
 for(const n of unpacked)if(asar.statFile(next,n,false).unpacked!==true)throw Error('ARCHIVE_UNPACKED_LAYOUT_CHANGED');
 const members=asar.listPackage(next);for(const name of members){const n=name.replace(/^[/\\]/,'');const info=asar.statFile(next,n,false);if(!info.files&&!info.link)asar.extractFile(next,n);}
 const header=asar.getRawHeader(next).headerString;
 fs.renameSync(next,archive);if(fs.existsSync(next+'.unpacked'))fs.cpSync(next+'.unpacked',archive+'.unpacked',{recursive:true});asar.uncache(archive);
 const result={version,mode,asarSha256:sha(fs.readFileSync(archive)),asarHeaderSha256:sha(Buffer.from(header)),members:members.length,unpackedMembers:unpacked.length};
 fs.writeFileSync(path.join(work,'ARCHIVE_'+mode+'.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

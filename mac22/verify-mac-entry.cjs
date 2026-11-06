'use strict';
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const [source,app,expected,out]=process.argv.slice(2),req=createRequire(path.join(source,'package.json'));
const result=req('./electron/macAppEntryVerification.cjs').verifyInstalledMacApp({appPath:app,
 expectedAsarSha256:expected,asar:req('@electron/asar')});
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});

'use strict';
// The same header hashing used by the accepted Mac21 assembly.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const [source,file,output]=process.argv.slice(2);
if(process.env.GITHUB_ACTIONS!=='true'||process.platform!=='darwin')throw Error('OWNED_MAC_BUILD_ONLY');
const asar=createRequire(path.join(source,'package.json'))('@electron/asar');
const header=asar.getRawHeader(file).headerString;
fs.writeFileSync(output,JSON.stringify({algorithm:'SHA256',sha256:crypto.createHash('sha256').update(Buffer.from(header)).digest('hex')})+'\n',{flag:'wx'});

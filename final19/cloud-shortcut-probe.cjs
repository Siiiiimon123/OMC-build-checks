'use strict';
// Isolated NSIS diagnosis, using the existing locked builder toolset only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createRequire}=require('node:module'),{spawnSync}=require('node:child_process'),os=require('node:os');
async function main(){
 const [source,inputs,work,evidence]=process.argv.slice(2),req=createRequire(path.join(source,'package.json'));
 assert(process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks');
 assert.equal(req('app-builder-lib/package.json').version,'26.15.3');
 fs.mkdirSync(work);const tool=req('app-builder-lib/out/toolsets/windows'),bin=await tool.getMakeNsisPath(),plugins=await tool.getNsisPluginsPath();
 const original=fs.readFileSync(path.join(inputs,'packaging/shortcut-binding.nsh'),'utf8');
 const line='  WinShell::SetLnkAUMI "${LinkPath}" "${APP_ID}"';assert.equal(original.split(line).length,2);
 const env={...process.env,...bin.env};for(const k of Object.keys(env))if(k.toLowerCase()==='psmodulepath'||/^(OMC_PREVIEW15_TRANSPORT_KEY|GH_TOKEN|GITHUB_TOKEN)$/.test(k))delete env[k];
 const result={schema:'omc-cloud-shortcut-differential-probe-v1',windows:os.release(),builder:'26.15.3',existingMacroSha256:crypto.createHash('sha256').update(original).digest('hex'),variants:[],productChanged:false,releaseAccepted:false};
 function run(exe,args,label,options={}){const r=spawnSync(exe,args,{env,windowsHide:true,encoding:'utf8',timeout:120000,...options});fs.writeFileSync(path.join(evidence,label+'.log'),String(r.stdout||'')+String(r.stderr||''));assert(!r.error&&r.status===0,label+':'+String(r.error||r.status));return r;}
 for(const variant of ['current','without-aumi']){
  const dir=path.join(work,variant);fs.mkdirSync(dir);const header=path.join(dir,'binding.nsh');fs.writeFileSync(header,variant==='current'?original:original.replace(line,''));
  const exe=path.join(dir,'probe.exe'),nsi=path.join(dir,'probe.nsi');
  const script=[
   'Unicode true','Name "OMC cloud link diagnosis"',`OutFile "${exe}"`,'RequestExecutionLevel user','SilentInstall silent',
   '!define APP_ID "com.omc.photo-select"',`!addplugindir /x86-unicode "${path.join(plugins,'x86-unicode')}"`,`!include "${header}"`,
   'Section',`StrCpy $INSTDIR "${dir}"`,'SetOutPath "$INSTDIR"','CopyFiles /SILENT "$SYSDIR\\cmd.exe" "$INSTDIR\\OMC-Photo-Select.exe"',
   'CreateShortCut "$INSTDIR\\native.lnk" "$INSTDIR\\OMC-Photo-Select.exe" "" "$INSTDIR\\OMC-Photo-Select.exe" 0',
   'CreateShortCut "$INSTDIR\\native-aumi.lnk" "$INSTDIR\\OMC-Photo-Select.exe" "" "$INSTDIR\\OMC-Photo-Select.exe" 0',
   'WinShell::SetLnkAUMI "$INSTDIR\\native-aumi.lnk" "${APP_ID}"',
   '!insertmacro OMC_BindPayloadShortcut "$INSTDIR\\macro.lnk"','!insertmacro OMC_BindPayloadShortcut "$INSTDIR\\绑定中文.lnk"',
   'SetErrorLevel 0','SectionEnd',''].join('\r\n');
  fs.writeFileSync(nsi,'\ufeff'+script);run(bin.path,['/V3',nsi],'compile-'+variant);run(exe,[],'execute-'+variant);
  const ps=path.join(dir,'read-links.ps1'),json=path.join(dir,'links.json');
  const escape=s=>s.replaceAll("'","''");
  fs.writeFileSync(ps,"$ErrorActionPreference='Stop';$s=New-Object -ComObject WScript.Shell;$rows=@(Get-ChildItem -LiteralPath '"+escape(dir)+"' -Filter '*.lnk'|ForEach-Object{$l=$s.CreateShortcut($_.FullName);[ordered]@{name=$_.Name;bytes=$_.Length;target=$l.TargetPath;icon=$l.IconLocation;rawBase64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($_.FullName))}});$rows|ConvertTo-Json -Depth 5|Set-Content -LiteralPath '"+escape(json)+"' -Encoding UTF8");
  run('powershell.exe',['-NoProfile','-File',ps],'read-'+variant);
  const rows=JSON.parse(fs.readFileSync(json,'utf8').replace(/^\ufeff/,''));assert.equal(rows.length,4);
  result.variants.push({name:variant,expected:path.join(dir,'OMC-Photo-Select.exe'),rows});
 }
 fs.writeFileSync(path.join(evidence,'SHORTCUT_DIFFERENTIAL.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'DIAGNOSTIC_COMPLETE_NOT_RELEASE',variants:result.variants.map(v=>({name:v.name,rows:v.rows.map(r=>({name:r.name,target:r.target,icon:r.icon}))}))}));
}
main().catch(e=>{console.error(String(e.stack||e));process.exitCode=1;});

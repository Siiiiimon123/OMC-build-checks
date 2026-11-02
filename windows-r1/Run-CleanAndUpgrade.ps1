param([string]$InputsPath=(Join-Path $PSScriptRoot 'PACKAGE_INPUTS.json'),[string]$BuiltCurrentInstaller,[string]$BuiltPreviousInstaller,[switch]$OmcHelpersOnly)
$ErrorActionPreference='Stop'
function Assert-LocalExact($asset,$file){
  $root=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')+'\';$absolute=[IO.Path]::GetFullPath($file)
  if(-not $absolute.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Local installer outside owned RunnerTemp'}
  $cursor=$absolute;while($cursor -and $cursor.Length -ge $root.TrimEnd('\').Length){$item=Get-Item -LiteralPath $cursor -Force;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Local installer reparse path'};$cursor=[IO.Path]::GetDirectoryName($cursor)}
  $item=Get-Item -LiteralPath $absolute -Force;if($item.PSIsContainer -or $item.Length -ne $asset.bytes -or (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.sha256){throw 'Built local installer length/SHA mismatch'}
}

function DownloadExact($asset,$target){Invoke-WebRequest -Uri $asset.url -OutFile $target -TimeoutSec 900;if((Get-Item -LiteralPath $target).Length -ne $asset.bytes -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.sha256){throw 'Installer download identity mismatch'}}
function NormalizeDir([string]$p){ if([string]::IsNullOrWhiteSpace($p)){ return $null }; try { return [IO.Path]::GetFullPath($p).TrimEnd([char]92) } catch { return $null } }
function Registrations { return ,[object[]]@(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue|ForEach-Object {Get-ItemProperty -LiteralPath $_.PSPath}|Where-Object {$_.DisplayName -like 'OMC*Preview*'}) }
function InstallRoot { $reg=Registrations;if($reg.Count -ne 1){throw 'Exact canonical registration required'};[IO.Path]::GetFullPath((Get-ItemProperty -LiteralPath ('HKCU:\Software\'+$reg[0].PSChildName) -Name InstallLocation).InstallLocation) }
function WaitInstaller($file,$args){$p=Start-Process -FilePath $file -ArgumentList $args -PassThru -WindowStyle Hidden;if(!$p.WaitForExit(120000)){throw 'Owned installer timeout'};if($p.ExitCode -ne 0){throw ('Installer exit '+$p.ExitCode)}}
function Get-UninstallResiduals([string]$installRoot){
  $want=NormalizeDir $installRoot
  $hits=New-Object System.Collections.Generic.List[object]
  $uninstallHives=@(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach($hive in $uninstallHives){
    Get-ChildItem -LiteralPath $hive -ErrorAction SilentlyContinue | ForEach-Object {
      $props=Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
      if(-not $props){ return }
      $loc=$null
      if($props.PSObject.Properties.Name -contains 'InstallLocation'){ $loc=NormalizeDir ([string]$props.InstallLocation) }
      $name=[string]$props.DisplayName
      $isOmC = ($name -like 'OMC*Preview*') -or ($name -like 'OMC*')
      $pathMatch = $loc -and $want -and ($loc.Equals($want,[StringComparison]::OrdinalIgnoreCase))
      if($pathMatch -or ($isOmC -and $pathMatch)){
        if($pathMatch){
          $vals=@{}; foreach($pn in @('DisplayName','DisplayVersion','InstallLocation','UninstallString','QuietUninstallString','Publisher')){ if($props.PSObject.Properties.Name -contains $pn){ $vals[$pn]=[string]$props.$pn } }
          $hits.Add([ordered]@{hive=$hive; keyPath=$_.PSPath; psChildName=$_.PSChildName; values=$vals}) | Out-Null
        }
      }
    }
  }
  $softwareHives=@('HKCU:\Software','HKLM:\Software','HKLM:\Software\WOW6432Node')
  foreach($hive in $softwareHives){
    Get-ChildItem -LiteralPath $hive -ErrorAction SilentlyContinue | ForEach-Object {
      $props=Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
      if(-not $props){ return }
      if($props.PSObject.Properties.Name -notcontains 'InstallLocation'){ return }
      $loc=NormalizeDir ([string]$props.InstallLocation)
      if(-not ($loc -and $want -and $loc.Equals($want,[StringComparison]::OrdinalIgnoreCase))){ return }
      $vals=@{InstallLocation=[string]$props.InstallLocation}
      if($props.PSObject.Properties.Name -contains 'DisplayName'){ $vals['DisplayName']=[string]$props.DisplayName }
      $hits.Add([ordered]@{hive=$hive; keyPath=$_.PSPath; psChildName=$_.PSChildName; values=$vals}) | Out-Null
    }
  }
  # Return a plain object[] via unary comma (never @($genericList) — seventh pwsh Argument-types).
  # Unary comma keeps empty object[] from collapsing to $null under Windows PowerShell 5.
  # Callers MUST assign the function output directly ($x = Get-UninstallResiduals ...) and test $x.Count.
  # Do NOT wrap the call in @(...): that re-nests the empty array so Count becomes 1 (eighth FAIL [[]]).
  [object[]]$arr = $hits.ToArray()
  if ($arr.Length -eq 0) { return ,[object[]]@() }
  return ,$arr
}

function WaitOwnedUninstall([string]$installRoot){
  $reg=Registrations
  if($reg.Count -ne 1){ throw 'Exact canonical registration required before uninstall' }
  $entry=$reg[0]
  $quiet=[string]$entry.QuietUninstallString
  if([string]::IsNullOrWhiteSpace($quiet)){ throw 'QuietUninstallString missing on canonical Uninstall key' }
  if($quiet -notmatch '(?i)/currentuser'){ $quiet = $quiet.TrimEnd() + ' /currentuser' }
  # Parse QuietUninstallString: optional quoted exe + remaining args
  $exe=$null; $argLine=$null
  if($quiet -match '^\s*"([^"]+)"\s*(.*)$'){ $exe=$Matches[1]; $argLine=$Matches[2].Trim() }
  elseif($quiet -match '^\s*(\S+)\s*(.*)$'){ $exe=$Matches[1]; $argLine=$Matches[2].Trim() }
  else { throw 'Unable to parse QuietUninstallString' }
  if(-not (Test-Path -LiteralPath $exe)){ throw ('QuietUninstall exe missing: '+$exe) }
  $launcherName=[IO.Path]::GetFileNameWithoutExtension($exe)
  $beforePids=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -and (
      $_.Name -like 'Un*.exe' -or
      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:TEMP,[StringComparison]::OrdinalIgnoreCase) -and $_.Name -like 'Un*.exe')
    )
  } | ForEach-Object { $_.ProcessId })
  # Keep ArgumentList as object[] of one string (PS5/pwsh-safe); do not replace @() with a bare string.
  [object[]]$argList = @()
  if(-not [string]::IsNullOrWhiteSpace($argLine)){ $argList = [object[]]@([string]$argLine) }
  $p=Start-Process -FilePath $exe -ArgumentList $argList -PassThru -WindowStyle Hidden
  if(-not $p.WaitForExit(120000)){ throw 'Owned uninstall launcher timeout' }
  if($p.ExitCode -ne 0){ throw ('Uninstall launcher exit '+$p.ExitCode) }
  # Wait for NSIS self-copy child under TEMP (Un*.exe) that appeared after launch
  $childDeadline=[DateTime]::UtcNow.AddSeconds(120)
  do {
    $children=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ProcessId -notin $beforePids -and $_.Name -and (
        ($_.ExecutablePath -and (
          $_.ExecutablePath.StartsWith($env:TEMP,[StringComparison]::OrdinalIgnoreCase) -or
          $_.ExecutablePath.StartsWith((Join-Path $env:LOCALAPPDATA 'Temp'),[StringComparison]::OrdinalIgnoreCase)
        ) -and $_.Name -match '(?i)^Un.*\.exe$') -or
        ($_.Name -match '(?i)^Un_.*\.exe$' -or $_.Name -match '(?i)^Uninstall.*\.exe$')
      ) -and $_.ProcessId -ne $p.Id
    })
    if(-not $children.Count){ break }
    Start-Sleep -Milliseconds 250
  } while([DateTime]::UtcNow -lt $childDeadline)
  if($children.Count){
    foreach($c in $children){
      try { $cp=Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue; if($cp -and -not $cp.WaitForExit(120000)){ throw ('Owned self-copy uninstall timeout pid='+$c.ProcessId) } } catch { throw }
    }
  }
  # Poll HKCU+HKLM residuals belonging to this install directory for up to 120s
  $pollDeadline=[DateTime]::UtcNow.AddSeconds(120)
  $residuals = ,[object[]]@()
  do {
    # Direct assign (no @() wrap) so empty unary-comma return yields Count 0, not nested Count 1.
    $residuals = Get-UninstallResiduals $installRoot
    if ($null -eq $residuals) { $residuals = ,[object[]]@() }
    if (-not $residuals.Count) { return }
    Start-Sleep -Milliseconds 500
  } while([DateTime]::UtcNow -lt $pollDeadline)
  $script:report.uninstallResiduals = $residuals
    $detail = ($residuals | ForEach-Object {
    # Indexer access: OrderedDictionary.Values property shadows the 'values' entry key.
    if ($null -eq $_) {
      '<null-entry>'
    } else {
      $kp = $null
      $vals = $null
      if ($_ -is [System.Collections.IDictionary]) {
        if ($_.Contains('keyPath')) { $kp = $_['keyPath'] }
        if ($_.Contains('values')) { $vals = $_['values'] }
      } else {
        if ($null -ne $_.PSObject.Properties['keyPath']) { $kp = $_.keyPath }
        if ($null -ne $_.PSObject.Properties['values']) { $vals = $_.values }
      }
      if ($null -eq $kp) { $kp = '<null-keyPath>' } else { $kp = [string]$kp }
      $parts = New-Object System.Collections.Generic.List[string]
      if ($null -eq $vals) {
        [void]$parts.Add('<null-values>')
      } elseif ($vals -is [System.Collections.IDictionary]) {
        foreach ($de in @($vals.GetEnumerator())) {
          $k = if ($null -eq $de.Key) { '' } else { [string]$de.Key }
          $v = if ($null -eq $de.Value) { '' } else { [string]$de.Value }
          [void]$parts.Add($k + '=' + $v)
        }
      } else {
        [void]$parts.Add('<non-dict-values>')
      }
      $kp + ' => ' + ($parts -join '; ')
    }
  }) -join ' || '
  throw ('Owned18 uninstall did not remove canonical registration; residuals: ' + $detail)
}
function CheckPng($file){Add-Type -AssemblyName System.Drawing;$b=[Drawing.Bitmap]::new($file);try{$colors=[Collections.Generic.HashSet[int]]::new();for($y=0;$y -lt $b.Height;$y+=17){for($x=0;$x -lt $b.Width;$x+=17){[void]$colors.Add($b.GetPixel($x,$y).ToArgb())}};if($colors.Count -lt 8){throw 'Actual renderer screenshot is blank/uniform'};return @{width=$b.Width;height=$b.Height;distinctSampledColors=$colors.Count}}finally{$b.Dispose()}}
function OpenActualLink($root,$profile,$mode,$out,$expectedVersion,$snapshot){
 $exe=Join-Path $root 'OMC-Photo-Select.exe'
 # Collect then cast to object[] so 0/1 FileInfo never becomes a scalar under PS5/pwsh.
 $linkHits = New-Object System.Collections.Generic.List[object]
 foreach($kind in @('DesktopDirectory','CommonDesktopDirectory')){
   $d=[Environment]::GetFolderPath([Enum]::Parse([Environment+SpecialFolder],$kind),[Environment+SpecialFolderOption]::DoNotVerify)
   if($d -and (Test-Path -LiteralPath $d)){
     Get-ChildItem -LiteralPath $d -Filter 'OMC*Preview.lnk' -File -ErrorAction SilentlyContinue | ForEach-Object { [void]$linkHits.Add($_) }
   }
 }
 $links = [object[]]@($linkHits.ToArray() | Sort-Object FullName -Unique)
 if(@($links).Count -ne 1){throw 'Exactly one genuine product desktop shortcut required'};$link=$links[0].FullName
 & $node (Join-Path $PSScriptRoot 'inspect-installed.mjs') --link-icon $link $exe;if($LASTEXITCODE){throw 'Original installed shortcut icon wrong'}
 & $node (Join-Path $PSScriptRoot 'inspect-installed.mjs') --link-add-args $link ('--remote-debugging-port=0 --remote-debugging-address=127.0.0.1 --user-data-dir='+$profile);if($LASTEXITCODE){throw 'QA transport-only shortcut adaptation failed'}
 foreach($key in @(Get-ChildItem Env:|Where-Object {$_.Name -match '^(PYTHON|NODE_|OMC_|VITE_|VIRTUAL_ENV|CONDA_|ELECTRON_)'}|ForEach-Object {$_.Name})){Remove-Item ('Env:'+$key) -ErrorAction SilentlyContinue};$env:PATH=Join-Path $env:SystemRoot 'System32'
 if(@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -eq $exe}).Count){throw 'No pre-existing installed App allowed'}
 Start-Process -FilePath $link -WorkingDirectory $root -ErrorAction Stop
 $end=[DateTime]::UtcNow.AddSeconds(60);$app=$null;while([DateTime]::UtcNow -lt $end){$m=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '\s--type='});if($m.Count -gt 1){throw 'Multiple main processes'};if($m.Count -eq 1){$app=Get-Process -Id $m[0].ProcessId;$held=$app.Handle;break};Start-Sleep -Milliseconds 250};if(!$app){throw 'Actual link did not launch expected executable'}
 try {& $node (Join-Path $PSScriptRoot 'inspect-installed.mjs') $mode $profile (Join-Path $env:RUNNER_TEMP 'native-generated-r1.jpg') $out $expectedVersion $snapshot;if($LASTEXITCODE){throw 'Real renderer/project/AI stage failed'};$shot=CheckPng ($out+'.png')}
 finally{& "$env:SystemRoot\System32\taskkill.exe" /PID $app.Id|Out-Null;if($LASTEXITCODE -ne 0 -or !$app.WaitForExit(15000) -or $null -eq $app.ExitCode -or $app.ExitCode -ne 0){throw 'Normal owned App exit0 required'};$prefix=$root.TrimEnd([char]92)+'\';$end=[DateTime]::UtcNow.AddSeconds(8);do{$remaining=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)});if(!$remaining.Count){break};Start-Sleep -Milliseconds 250}while([DateTime]::UtcNow -lt $end);if($remaining.Count){throw 'Owned App children remained'};[IO.File]::WriteAllBytes($link,[IO.File]::ReadAllBytes($link+'.qa-original'));Move-Item -LiteralPath ($link+'.qa-original') -Destination (Join-Path $work ('original-link-'+$mode.TrimStart('-')+'.lnk'))}
 return @{actualLink=$link;actualExe=$exe;mainPid=$app.Id;normalExitCode=$app.ExitCode;screenshot=$shot}
}
if($OmcHelpersOnly){ return }
$node=(Get-Command node -CommandType Application|Select-Object -First 1).Source
$inputs=Get-Content -LiteralPath ($InputsPath) -Raw|ConvertFrom-Json
if($inputs.authorization -ne 'user-r1-execution-20261101' -or $inputs.sourceTree -ne 'cb0aaee04d7a99e4b175e2b8b039a23afec85006' -or $inputs.current.version -ne '1.0.21-preview.18' -or $inputs.previous.sha256 -ne '9eda59434c38b50085edd041dd9a7b06e2476e6a99cc0e3c3a7c353695f9703d'){throw 'New frozen built-source inputs required'}
$work=Join-Path $env:RUNNER_TEMP 'omc-r1-x64';if(Test-Path -LiteralPath $work){throw 'Fresh owned workspace required'};[void][IO.Directory]::CreateDirectory($work)
$report=[ordered]@{status='RUNNING';syntheticOnly=$true;memberDataUsed=$false;wizardClicksTested=$false;bareWindowsQualified=$false;newDependenciesInstalledForApp=$false;upgradeViaSignedInAppUpdateTested=$false;cleanupForced=$false}
if($env:GITHUB_ACTIONS -ne 'true' -or $env:GITHUB_REPOSITORY -ne 'Siiiiimon123/OMC-build-checks' -or $env:GITHUB_REF -ne 'refs/heads/verify-windows-r1-18' -or $env:GITHUB_RUN_ATTEMPT -ne '1' -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -ne 'X64'){throw 'Disposable approved x64 CI only; never member PC'}
try{
 if((Registrations).Count){throw 'Clean canonical HKCU required'}
 $new=Join-Path $work 'member18.exe';$old=Join-Path $work 'released16.exe';if($BuiltCurrentInstaller){Assert-LocalExact $inputs.current $BuiltCurrentInstaller;$new=$BuiltCurrentInstaller}else{DownloadExact $inputs.current $new};if($BuiltPreviousInstaller){Assert-LocalExact $inputs.previous $BuiltPreviousInstaller;$old=$BuiltPreviousInstaller}else{DownloadExact $inputs.previous $old}
 & (Join-Path $PSScriptRoot 'Verify-FirstInstall.ps1') -Installer $new -InstallerSha256 $inputs.current.sha256 -AppAsarSha256 $inputs.current.asarSha256 -ExeSha256 $inputs.current.exeSha256 -BackendSha256 $inputs.current.backendSha256 -NodeExecutable $node -ExpectedVersion $inputs.current.version
 $clean=Get-Content -LiteralPath (Join-Path $env:RUNNER_TEMP 'omc-first-install-report.json') -Raw|ConvertFrom-Json;if($clean.status -ne 'PASS_SCOPED_CANONICAL_FIRST_INSTALL_AND_DEFAULT_STARTUP' -or !$clean.normalExitVerified){throw 'Clean18 failed'};$report.clean18=$clean;$report.cleanScreenshot=CheckPng ((Join-Path $env:RUNNER_TEMP 'CLEAN_NATIVE_AI.json')+'.png')
 # Disposable runner only. Preserve clean18 default profile; upgrade uses a separate owned synthetic profile.
 $root=InstallRoot
 WaitOwnedUninstall $root
 $postResiduals = Get-UninstallResiduals $root; if ($null -eq $postResiduals) { $postResiduals = ,[object[]]@() }; if ((Registrations).Count -or $postResiduals.Count) { $report.uninstallResiduals = $postResiduals; throw 'Owned18 uninstall did not remove canonical registration' }
 WaitInstaller $old '/S';$root16=InstallRoot;if((Get-FileHash -LiteralPath (Join-Path $root16 'resources/app.asar') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $inputs.previous.asarSha256){throw 'Genuine released16 payload mismatch'}
 $upgradeProfile=Join-Path $work 'upgrade-profile';$snapshot=Join-Path $work 'synthetic-project-snapshot.json'
 $report.seed16=OpenActualLink $root16 $upgradeProfile '--seed' (Join-Path $env:RUNNER_TEMP 'UPGRADE16_SEED.json') $inputs.previous.version $snapshot
 WaitInstaller $new '/S';$root18=InstallRoot;if((Get-FileHash -LiteralPath (Join-Path $root18 'resources/app.asar') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $inputs.current.asarSha256 -or (Get-FileHash -LiteralPath (Join-Path $root18 'resources/ai-service/ai-service.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $inputs.current.backendSha256){throw 'Upgraded18 bytes differ'}
 $report.restore18=OpenActualLink $root18 $upgradeProfile '--restore' (Join-Path $env:RUNNER_TEMP 'UPGRADE18_RESTORED.json') $inputs.current.version $snapshot
 $report.status='PASS_SCOPED_CLEAN18_AND_REAL_RELEASED16_TO18_INSTALLER_UPGRADE_SYNTHETIC_PROJECT_AI_EXIT'
}catch{$report.status='FAIL';$report.failure=$_.Exception.Message;throw}
finally{$report|ConvertTo-Json -Depth 12|Set-Content -LiteralPath (Join-Path $env:RUNNER_TEMP 'WINDOWS_R1_RESULT.json') -Encoding utf8}

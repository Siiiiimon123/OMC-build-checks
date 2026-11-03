param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$InstallerSha256,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$AppAsarSha256,
  [Parameter(Mandatory=$true)][string]$ExeSha256,
  [Parameter(Mandatory=$true)][string]$BackendSha256,
  [Parameter(Mandatory=$true)][string]$NodeExecutable,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Wait-Installer.ps1')
if($env:GITHUB_REF -ne 'refs/heads/verify-windows-r1-18' -or $env:GITHUB_RUN_ATTEMPT -ne '1'){throw 'Approved branch/first attempt only'}
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:GITHUB_REPOSITORY -ne 'Siiiiimon123/OMC-build-checks') {throw 'This script is only for the approved disposable GitHub Windows runner, never the user PC'}
$profile=Join-Path $env:APPDATA 'omc-photo-select'
$uninstallRoot='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
function Find-Registration { @(Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction SilentlyContinue|ForEach-Object {Get-ItemProperty -LiteralPath $_.PSPath}|Where-Object {$_.DisplayName -like 'OMC*Preview*'}) }
$report=Join-Path $env:RUNNER_TEMP 'omc-first-install-report.json'
if([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -ne 'X64'){throw 'Approved X64 Windows runner required'}
$result=[ordered]@{status='RUNNING';installerSha256=$InstallerSha256;canonicalInstallExecuted=$false;defaultProfileUsed=$true;bareWindows11Qualified=$false;notes=@('Disposable hosted Windows runner may contain developer tools; app launch PATH excludes them','Silent first-install path, not an automated wizard-click or full native-edit acceptance')}
function Desktop-Inventory {
  $rows=@(); $shell=$null; $comError=$null
  try {$shell=New-Object -ComObject WScript.Shell} catch {$comError=$_.Exception.Message}
  foreach($name in @('Desktop','DesktopDirectory','CommonDesktopDirectory')) {
    try {
    $folder=[Enum]::Parse([Environment+SpecialFolder],$name)
    $location=[Environment]::GetFolderPath($folder,[Environment+SpecialFolderOption]::DoNotVerify)
    $links=@()
    if($comError){throw ('Shortcut inspection unavailable: '+$comError)}
    if($location -and (Test-Path -LiteralPath $location -PathType Container)) {
      foreach($link in @(Get-ChildItem -LiteralPath $location -Filter '*.lnk' -File|Select-Object -First 128)) {
        try {$shortcut=$shell.CreateShortcut($link.FullName);$links+=@{path=$link.FullName;bytes=$link.Length;target=$shortcut.TargetPath;arguments=$shortcut.Arguments;icon=$shortcut.IconLocation}}
        catch {$links+=@{path=$link.FullName;error=$_.Exception.Message}}
      }
    }
    $rows+=@{folder=$name;path=$location;exists=($location -and (Test-Path -LiteralPath $location -PathType Container));links=$links}
    } catch {$rows+=@{folder=$name;path=$location;error=$_.Exception.Message;links=@()}}
  }
  return $rows
}

$app=$null;$exe=$null;$root=$null;$failureToThrow=$null
try {
  if((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash -ne $InstallerSha256){throw 'Installer identity mismatch'}
  if(Test-Path -LiteralPath $profile){throw 'Default OMC profile already exists: not a first-install test'}
  if((Find-Registration).Count){throw 'Existing OMC installation: refuse canonical overwrite'}
  $result.desktopBefore=Desktop-Inventory
  # A hosted runner may never have initialized the normal interactive desktop.
  # Preserve that state, then prepare only the official per-user desktop fixture.
  $desktop=[Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory,[Environment+SpecialFolderOption]::DoNotVerify)
  if([string]::IsNullOrWhiteSpace($desktop)){throw 'No physical desktop path available'}
  $desktop=[IO.Path]::GetFullPath($desktop)
  $profilePrefix=[IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd([char]92)+'\'
  if(!$desktop.StartsWith($profilePrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected hosted runner desktop fixture path'}
  $result.standardDesktopFixtureCreated=$false
  if(!(Test-Path -LiteralPath $desktop -PathType Container)) {
    [IO.Directory]::CreateDirectory($desktop)|Out-Null
    $result.standardDesktopFixtureCreated=$true
  }
  $result.notes+=@('Standard interactive desktop directory is initialized before install if absent; missing-desktop installation is not qualified')

  WaitInstaller -File $Installer -Report $result
  $result.canonicalInstallExecuted=$true
  $registration=Find-Registration
  if($registration.Count -ne 1){throw 'Expected exactly one new installation registration'}
  # electron-builder stores InstallLocation in Software\APP_GUID, separately
  # from the uninstall registration. Read the exact key identity we discovered.
  $installGuid=[Guid]::Empty
  if(![Guid]::TryParse([string]$registration[0].PSChildName,[ref]$installGuid)){throw 'Unexpected installation registration identity'}
  $installKey=Join-Path 'HKCU:\Software' ([string]$registration[0].PSChildName)
  $location=(Get-ItemProperty -LiteralPath $installKey -Name InstallLocation).InstallLocation
  if([string]::IsNullOrWhiteSpace($location)){throw 'Product installation registry path is missing'}
  $root=[IO.Path]::GetFullPath($location)
  $result.installRoot=$root
  $result.registeredDisplayIcon=$registration[0].DisplayIcon
  $result.registeredUninstallString=$registration[0].UninstallString
  $localPrefix=[IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd([char]92)+'\'
  if(!$root.StartsWith($localPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected installation location'}
  $exe=Join-Path $root 'OMC-Photo-Select.exe';$asar=Join-Path $root 'resources\app.asar'
  if((Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash -ne $AppAsarSha256){throw 'Installed App ASAR differs from qualified payload'}
  $result.installedAsarMatches=$true
  $result.desktopAfter=Desktop-Inventory
  $shortcutDeadline=[DateTime]::UtcNow.AddSeconds(10)
  do {
    $late=Desktop-Inventory
    $lateMatches=@($late|ForEach-Object {$_.links}|Where-Object {$_.target -eq $exe})
    if($lateMatches.Count){break}
    Start-Sleep -Milliseconds 250
  } while([DateTime]::UtcNow -lt $shortcutDeadline)
  $result.desktopAfterSettled=$late
  $result.installerBindingLogs=@()
  try {
    foreach($log in @(Get-ChildItem -LiteralPath $env:TEMP -Filter 'omc-preview15-shortcut-*.log' -File -ErrorAction Stop|Select-Object -First 32)) {
      try {$result.installerBindingLogs+=@{name=$log.Name;content=(Get-Content -LiteralPath $log.FullName -Raw -ErrorAction Stop)}}
      catch {$result.installerBindingLogs+=@{name=$log.Name;error=$_.Exception.Message}}
    }
  } catch {$result.installerBindingLogDiagnosticError=$_.Exception.Message}
  $links=$lateMatches
  $result.desktopShortcutInspectionTargetVerified=($links.Count -gt 0)
  $result.matchingDesktopLinks=$links

  foreach($name in @('ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH','PYTHONHOME','PYTHONPATH','VIRTUAL_ENV','CONDA_PREFIX')){Remove-Item ('Env:'+ $name) -ErrorAction SilentlyContinue}
  foreach($key in @(Get-ChildItem Env:|Where-Object {$_.Name -match '^(PYTHON|NODE_|OMC_|VITE_|VIRTUAL_ENV|CONDA_|ELECTRON_)'}|ForEach-Object {$_.Name})){Remove-Item ('Env:'+$key) -ErrorAction SilentlyContinue}
  $env:PATH=Join-Path $env:SystemRoot 'System32'
  # No user-data-dir override: exercise the actual first-launch default path.
  $result.osArchitecture=[Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  $result.shellProcessArchitecture=[Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
  $result.installedExeSha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  if($result.installedExeSha256 -ne $ExeSha256){throw 'Unexpected application executable bytes'}
  $actualLinks=@(
    foreach($folderKind in @('DesktopDirectory','CommonDesktopDirectory')){
      $folderPath=[Environment]::GetFolderPath([Enum]::Parse([Environment+SpecialFolder],$folderKind),[Environment+SpecialFolderOption]::DoNotVerify)
      if($folderPath -and (Test-Path -LiteralPath $folderPath -PathType Container)){
        Get-ChildItem -LiteralPath $folderPath -Filter 'OMC*Preview.lnk' -File|ForEach-Object {[pscustomobject]@{path=$_.FullName;bytes=$_.Length}}
      }
    }
  )|Sort-Object path -Unique
  $actualLinks=@($actualLinks)
  $result.actualProductLinks=$actualLinks
  if($actualLinks.Count -ne 1){throw 'Exactly one installed OMC desktop shortcut required'}
  if($actualLinks[0].bytes -le 0 -or $actualLinks[0].bytes -gt 65536){throw 'Installed shortcut size invalid'}
  $result.shortcutRawBase64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($actualLinks[0].path))
  $result.shortcutSecondParser=@{}
  try {
    $sa=New-Object -ComObject Shell.Application
    $item=$sa.Namespace([IO.Path]::GetDirectoryName($actualLinks[0].path)).ParseName([IO.Path]::GetFileName($actualLinks[0].path))
    $result.shortcutSecondParser=@{path=$item.GetLink.Path;targetParsingPath=$item.ExtendedProperty('System.Link.TargetParsingPath')}
  } catch {$result.shortcutSecondParser=@{error=$_.Exception.Message}}
  $existing=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -eq $exe})
  if($existing.Count){throw 'App already running before shortcut launch; cannot attribute startup to link'}
  $startRoot=[Environment]::GetFolderPath([Environment+SpecialFolder]::StartMenu)
  $startLinks=@(Get-ChildItem -LiteralPath $startRoot -Filter 'OMC*Preview.lnk' -File -Recurse)
  if($startLinks.Count -ne 1){throw 'Exactly one actual start-menu link required'}
  $sa2=New-Object -ComObject Shell.Application
  $startTarget=$sa2.Namespace($startLinks[0].DirectoryName).ParseName($startLinks[0].Name).GetLink.Path
  if([IO.Path]::GetFullPath($startTarget) -ne $exe){throw 'Start-menu link target differs'}
  & $NodeExecutable (Join-Path $PSScriptRoot 'inspect-installed.mjs') --link-icon $startLinks[0].FullName $exe
  if($LASTEXITCODE){throw 'Start-menu icon differs from installed payload'}
  $result.startMenuLinkVerified=@{path=$startLinks[0].FullName;target=$startTarget;iconVerified=$true}
  $result.launchMethod='installed-desktop-shortcut'
  # Test transport args only; original product target/icon remain unchanged.
  & $NodeExecutable (Join-Path $PSScriptRoot 'inspect-installed.mjs') --link-add-args $actualLinks[0].path '--remote-debugging-port=0 --remote-debugging-address=127.0.0.1'
  if($LASTEXITCODE -ne 0){throw 'Cannot add diagnostic transport args without changing target/icon'}
  & $NodeExecutable (Join-Path $PSScriptRoot 'inspect-installed.mjs') --link-icon $actualLinks[0].path $exe
  if($LASTEXITCODE -ne 0){throw 'Installed link icon contract failed'}
  Start-Process -FilePath $actualLinks[0].path -WorkingDirectory $root -ErrorAction Stop
  $startup=Join-Path $profile 'startup.log';$deadline=[DateTime]::UtcNow.AddSeconds(90);$ready=$false
  while([DateTime]::UtcNow -lt $deadline){
    $mains=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '\s--type='})
    if($mains.Count -gt 1){throw 'Multiple main processes after shortcut launch'}
    if($mains.Count -eq 1 -and !$app){
      $app=Get-Process -Id $mains[0].ProcessId -ErrorAction Stop
      $ownedAppHandle=$app.Handle
      if(!$ownedAppHandle -or $ownedAppHandle -eq [IntPtr]::Zero){throw 'Cannot retain owned App handle for the exit-code check'}
      $result.processHandleRetained=$true
      $result.shortcutStartedExePath=$mains[0].ExecutablePath;$result.shortcutStartedPid=$mains[0].ProcessId
    }
    if($app){$app.Refresh();if($app.HasExited){throw 'Shortcut-started application exited before readiness'}}
    if($app -and (Test-Path -LiteralPath $startup)){$text=Get-Content -LiteralPath $startup -Raw;if($text -match '"event":"renderer-ready"'){$ready=$true;break}}
    Start-Sleep -Milliseconds 500
  }
  if(!$ready){throw 'Actual shortcut did not produce the expected application and renderer'}
  $result.desktopShortcutLaunchVerified=$true
  $result.desktopShortcutTargetVerified=($result.shortcutStartedExePath -eq $exe)
  $steadyUntil=[DateTime]::UtcNow.AddSeconds(3)
  while([DateTime]::UtcNow -lt $steadyUntil){
    $app.Refresh()
    if($app.HasExited){throw ('Application exited after renderer readiness: '+$app.ExitCode)}
    Start-Sleep -Milliseconds 250
  }
  $app.Refresh()
  if($app.HasExited -or $app.MainWindowHandle -eq [IntPtr]::Zero){throw 'Installed application has no surviving main window'}
  $fixture=Join-Path $env:RUNNER_TEMP 'native-generated-r1.jpg'
  Add-Type -AssemblyName System.Drawing
  $b=[Drawing.Bitmap]::new(640,480);$g=[Drawing.Graphics]::FromImage($b)
  try{$g.Clear([Drawing.Color]::SteelBlue);$g.FillEllipse([Drawing.Brushes]::Orange,40,30,400,300);$g.DrawRectangle([Drawing.Pens]::White,12,12,600,440);$b.Save($fixture,[Drawing.Imaging.ImageFormat]::Jpeg)}finally{$g.Dispose();$b.Dispose()}
  if((Get-FileHash -LiteralPath (Join-Path $root 'resources/ai-service/ai-service.exe') -Algorithm SHA256).Hash -ne $BackendSha256){throw 'Installed backend differs'}
  & $NodeExecutable (Join-Path $PSScriptRoot 'inspect-installed.mjs') --inspect $profile $fixture (Join-Path $env:RUNNER_TEMP 'CLEAN_NATIVE_AI.json') $ExpectedVersion
  if($LASTEXITCODE -ne 0){throw 'Actual renderer/full bundled AI inspection failed'}
  $result.rendererReady=$true;$result.steadySeconds=3;$result.status='PASS_SCOPED_CANONICAL_FIRST_INSTALL_AND_DEFAULT_STARTUP'
  if(!$result.desktopShortcutLaunchVerified -or !$result.desktopShortcutTargetVerified -or $result.launchMethod -ne 'installed-desktop-shortcut'){throw 'Actual installed shortcut startup verification failed'}
} catch {$result.status='FAIL_FIRST_INSTALL_OR_STARTUP';$result.failure=$_.Exception.Message;$failureToThrow=$_}
finally {
  try {
    if($app){
      $normalCloseVerified=$false
      $app.Refresh()
      if($app.HasExited){
        $result.alreadyExitedBeforeClose=$true;$result.normalExitVerified=$false
        if(!$failureToThrow){throw ('Application exited before the normal close request: '+$app.ExitCode)}
      } else {
        $actual=Get-CimInstance Win32_Process -Filter ('ProcessId='+$app.Id)
        if($actual.ExecutablePath -ne $exe){throw 'Owned process identity changed before normal shutdown'}
        & "$env:SystemRoot\System32\taskkill.exe" /PID $app.Id|Out-Null
        $result.normalStopRequestExit=$LASTEXITCODE
        if($LASTEXITCODE -ne 0){throw 'Normal close request failed'}
        if(!$app.WaitForExit(15000)){throw 'Installed application did not exit normally within 15 seconds'}
        $observedExitCode=$app.ExitCode;$result.appExitCode=$observedExitCode
        if($null -eq $observedExitCode){throw 'Installed App exit code unavailable; this is not evidence of success or a crash'}
        if($observedExitCode -ne 0){throw ('Installed application quit with error: '+$observedExitCode)}
        $normalCloseVerified=$true
      }
      $rootPrefix=$root.TrimEnd([char]92)+'\';$exitDeadline=[DateTime]::UtcNow.AddSeconds(5)
      do {
        $remaining=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($rootPrefix,[StringComparison]::OrdinalIgnoreCase)})
        if($remaining.Count -eq 0){break}
        Start-Sleep -Milliseconds 250
      } while([DateTime]::UtcNow -lt $exitDeadline)
      $result.ownedProcessesAfterClose=$remaining.Count
      if($remaining.Count -ne 0){throw 'Installed App child processes remain after normal shutdown'}
      $result.normalExitVerified=$normalCloseVerified
    }
  } catch {
    $result.status='FAIL_FIRST_INSTALL_STARTUP_OR_NORMAL_EXIT';$result.cleanupFailure=$_.Exception.Message
    if(!$failureToThrow){$failureToThrow=$_}
  }
  if($actualLinks -and $actualLinks.Count -eq 1){$backup=$actualLinks[0].path+'.qa-original';if(Test-Path -LiteralPath $backup){if(Test-Path -LiteralPath $actualLinks[0].path){[IO.File]::WriteAllBytes($actualLinks[0].path,[IO.File]::ReadAllBytes($backup))};Move-Item -LiteralPath $backup -Destination (Join-Path $env:RUNNER_TEMP 'clean18-original-shortcut.lnk')}}
  try {
    $result|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $report -Encoding utf8
  } catch {
    Write-Warning 'Could not save the first-install report; original failure is preserved when present.'
    if(!$failureToThrow){$failureToThrow=$_}
  }
}
if($failureToThrow){throw $failureToThrow}




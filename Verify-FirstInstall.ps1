param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$InstallerSha256,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$AppAsarSha256
)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:GITHUB_REPOSITORY -ne 'Siiiiimon123/OMC-build-checks') {throw 'This script is only for the approved disposable GitHub Windows runner, never the user PC'}
$profile=Join-Path $env:APPDATA 'omc-photo-select'
$uninstallRoot='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
function Find-Registration { @(Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction SilentlyContinue|ForEach-Object {Get-ItemProperty -LiteralPath $_.PSPath}|Where-Object {$_.DisplayName -like 'OMC*Preview*'}) }
$report=Join-Path $env:RUNNER_TEMP 'omc-first-install-report.json'
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

  $installProcess=Start-Process -FilePath $Installer -ArgumentList '/S' -PassThru
  if(!$installProcess.WaitForExit(120000)){throw 'Installer timeout'}
  if($installProcess.ExitCode -ne 0){throw ('Installer exit: '+$installProcess.ExitCode)}
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
  $result.desktopShortcutTargetVerified=($links.Count -gt 0)
  $result.matchingDesktopLinks=$links

  foreach($name in @('ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH','PYTHONHOME','PYTHONPATH','VIRTUAL_ENV','CONDA_PREFIX')){Remove-Item ('Env:'+ $name) -ErrorAction SilentlyContinue}
  $env:PATH=Join-Path $env:SystemRoot 'System32'
  # No user-data-dir override: exercise the actual first-launch default path.
  $result.launchMethod='direct-exe-fallback-if-shortcut-invalid'
  if($links.Count) {
    try {$app=Start-Process -FilePath $links[0].path -WorkingDirectory $root -PassThru -ErrorAction Stop;$result.launchMethod='installed-desktop-shortcut'}
    catch {$result.desktopShortcutLaunchError=$_.Exception.Message;$result.launchMethod='direct-exe-fallback-after-shortcut-launch-error';$app=Start-Process -FilePath $exe -WorkingDirectory $root -PassThru}
  } else {$app=Start-Process -FilePath $exe -WorkingDirectory $root -PassThru}
  $startup=Join-Path $profile 'startup.log';$deadline=[DateTime]::UtcNow.AddSeconds(45);$ready=$false
  while([DateTime]::UtcNow -lt $deadline){
    $app.Refresh()
    if($app.HasExited){throw ('Application exited before renderer readiness: '+$app.ExitCode)}
    if(Test-Path -LiteralPath $startup){$text=Get-Content -LiteralPath $startup -Raw;if($text -match '"event":"renderer-ready"'){$ready=$true;break}}
    Start-Sleep -Milliseconds 250
  }
  if(!$ready){throw 'Default first-launch renderer readiness not reached'}
  $steadyUntil=[DateTime]::UtcNow.AddSeconds(3)
  while([DateTime]::UtcNow -lt $steadyUntil){
    $app.Refresh()
    if($app.HasExited){throw ('Application exited after renderer readiness: '+$app.ExitCode)}
    Start-Sleep -Milliseconds 250
  }
  $app.Refresh()
  if($app.HasExited -or $app.MainWindowHandle -eq [IntPtr]::Zero){throw 'Installed application has no surviving main window'}
  $result.rendererReady=$true;$result.steadySeconds=3;$result.status='PASS_SCOPED_CANONICAL_FIRST_INSTALL_AND_DEFAULT_STARTUP'
  if(!$result.desktopShortcutTargetVerified -or $result.launchMethod -ne 'installed-desktop-shortcut'){throw 'Application desktop shortcut invalid; direct startup evidence retained'}
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
        if($app.ExitCode -ne 0){throw ('Installed application quit with error: '+$app.ExitCode)}
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
  try {
    $result|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $report -Encoding utf8
  } catch {
    Write-Warning 'Could not save the first-install report; original failure is preserved when present.'
    if(!$failureToThrow){$failureToThrow=$_}
  }
}
if($failureToThrow){throw $failureToThrow}

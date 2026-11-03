param(
  [string]$Repo = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = 'Stop'
$mainPath = Join-Path $Repo 'windows-r1\Run-CleanAndUpgrade.ps1'
$firstPath = Join-Path $Repo 'windows-r1\Verify-FirstInstall.ps1'
$waitPath = Join-Path $Repo 'windows-r1\Wait-Installer.ps1'
foreach ($path in @($mainPath, $firstPath, $waitPath)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing script: $path" }
  $tokens = $null; $errors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw "Parse errors in ${path}: $($errors -join '; ')" }
}
function Assert([bool]$condition, [string]$message) { if (-not $condition) { throw $message } }
function Case([string]$name, [scriptblock]$body) { & $body; Write-Output "PASS $name" }

Case 'residual return shape: empty, one and multiple' {
  # Exercise the real function with isolated registry-provider stubs; no registry writes.
  . $mainPath -OmcHelpersOnly
  function Test-Path { param($LiteralPath, $ErrorAction) if ($script:registryFailure -eq 'hive-query') { throw 'simulated hive query failure' }; if ($LiteralPath -eq $script:missingHive) { return $false }; return $true }
  function Get-ChildItem { param($LiteralPath, $ErrorAction) if ($script:registryFailure -eq 'enumerate') { throw 'simulated enumeration failure' }; if ($LiteralPath -eq $script:missingHive) { throw 'missing hive should not be enumerated' }; $script:fakeKeys | Where-Object { $_.Hive -eq $LiteralPath } }
  function Get-ItemProperty { param($LiteralPath, $ErrorAction) if ($script:registryFailure -eq 'read') { throw 'simulated property failure' }; $script:fakeProperties[$LiteralPath] }
  function Get-Item { param($LiteralPath, $ErrorAction) if ($script:registryFailure -eq 'empty-key-disappeared') { throw 'simulated empty key disappeared' }; if ($ErrorAction -ne 'Stop') { throw 'empty-key check is not fail-closed' }; return [pscustomobject]@{PSPath=$LiteralPath} }
  $script:registryFailure = ''
  $script:missingHive = ''
  $root = Join-Path $env:TEMP 'omc-caller-path-virtual-root'
  $script:fakeKeys = @(); $script:fakeProperties = @{}
  $empty = Get-UninstallResiduals $root
  Assert ($empty -is [object[]] -and $empty.Count -eq 0) 'direct empty must be object[] with Count=0'
  $wrapped = @(Get-UninstallResiduals $root)
  Assert ($wrapped.Count -eq 1 -and $wrapped[0] -is [object[]] -and $wrapped[0].Count -eq 0) 'eighth failure reproducer changed'
  $hive = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  foreach ($i in 1..2) {
    $key = [pscustomobject]@{Hive=$hive; PSPath="test-$i"; PSChildName="test-$i"}
    $script:fakeKeys += $key
    $script:fakeProperties[$key.PSPath] = [pscustomobject]@{InstallLocation=$root; DisplayName="OMC Test $i"}
  }
  $oneKey = $script:fakeKeys[0]; $script:fakeKeys = @($oneKey)
  $one = Get-UninstallResiduals $root
  Assert ($one -is [object[]] -and $one.Count -eq 1 -and $null -ne $one[0]['values']) 'one residual missing or mis-shaped'
  $script:fakeKeys += $key
  $many = Get-UninstallResiduals $root
  Assert ($many -is [object[]] -and $many.Count -eq 2) 'multiple residuals missing or mis-shaped'
  Assert ((@($many | Where-Object { $_['values']['InstallLocation'] -eq $root })).Count -eq 2) 'residual values unavailable'
  foreach ($failure in @('hive-query','enumerate','read')) {
    $script:registryFailure=$failure; $failed=$false
    try { Get-UninstallResiduals $root | Out-Null } catch { $failed=$_.Exception.Message -match 'simulated' }
    Assert $failed "registry $failure failure must not be interpreted as no residuals"
  }
  $script:registryFailure=''
  $script:missingHive=$hive
  $missing=Get-UninstallResiduals $root
  Assert ($missing -is [object[]] -and $missing.Count -eq 0) 'genuinely absent hive should be skipped'
  $script:missingHive=''
  foreach ($emptyHive in @($hive,'HKCU:\Software')) {
    $script:fakeKeys=@([pscustomobject]@{Hive=$emptyHive; PSPath='empty-key'; PSChildName='empty-key'})
    $script:fakeProperties=@{ 'empty-key'=$null }
    $emptyKeyResult=Get-UninstallResiduals $root
    Assert ($emptyKeyResult -is [object[]] -and $emptyKeyResult.Count -eq 0) 'existing empty key should be skipped after rechecking'
    $script:registryFailure='empty-key-disappeared'; $failed=$false
    try { Get-UninstallResiduals $root | Out-Null } catch { $failed=$_.Exception.Message -match 'simulated empty key disappeared' }
    Assert $failed 'empty key disappearing during inspection must fail closed'
    $script:registryFailure=''
  }
  $canonicalId='{271538ED-F260-43FA-BDB6-2CC3124C9872}'
  foreach ($canonicalHive in @($hive,'HKCU:\Software')) {
    foreach ($kind in @('empty','other','wrong-location')) {
      $script:fakeKeys=@(
        [pscustomobject]@{Hive=$canonicalHive; PSPath='canonical-key'; PSChildName=$canonicalId},
        [pscustomobject]@{Hive=$canonicalHive; PSPath='unknown-key'; PSChildName='unrelated'}
      )
      $props = switch ($kind) {
        'empty' { $null }
        'other' { [pscustomobject]@{ Publisher='test' } }
        'wrong-location' { [pscustomobject]@{ InstallLocation=(Join-Path $env:TEMP 'other-root') } }
      }
      $script:fakeProperties=@{'canonical-key'=$props; 'unknown-key'=$null}
      $canonicalResidual=Get-UninstallResiduals $root $canonicalId
      Assert ($canonicalResidual -is [object[]] -and $canonicalResidual.Count -eq 1) "canonical $canonicalHive / $kind must remain a residual; unknown empty key must be ignored"
      Assert ($canonicalResidual[0]['psChildName'] -eq $canonicalId) 'canonical residual identity missing'
    }
  }
  $source = [IO.File]::ReadAllText($mainPath)
  Assert ($source -notmatch '@\(\s*Get-UninstallResiduals\b') 'real caller wraps unary-comma return'
}

Case 'canonical identity flows through actual uninstall gate and poll' {
  . $mainPath -OmcHelpersOnly
  $canonicalId='{271538ED-F260-43FA-BDB6-2CC3124C9872}'
  $script:receivedId=$null
  function Registrations { return ,([object[]]@([pscustomobject]@{PSChildName=$canonicalId;QuietUninstallString='"C:\fake\uninstall.exe" /S'})) }
  function Test-Path { param($LiteralPath) return $true }
  function Get-CimInstance { param($ClassName,$ErrorAction) return }
  function Start-Process {
    param($FilePath,$ArgumentList,[switch]$PassThru,$WindowStyle)
    $p=[pscustomobject]@{Id=101;ExitCode=0}
    $p | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($ms) return $true } -PassThru
  }
  function Get-UninstallResiduals($installRoot,$id) { $script:receivedId=$id; return ,[object[]]@() }
  WaitOwnedUninstall $env:TEMP $canonicalId
  Assert ($script:receivedId -eq $canonicalId) 'uninstall poll did not pass canonical identity'

  $source=[IO.File]::ReadAllText($mainPath)
  $begin=$source.IndexOf('$root=InstallRoot'); $end=$source.IndexOf('WaitInstaller -File $old ', $begin)
  Assert ($begin -ge 0 -and $end -gt $begin) 'uninstall gate source not found'
  $script:registryCalls=0; $script:waitId=$null; $script:postId=$null
  function InstallRoot { return $env:TEMP }
  function Registrations {
    $script:registryCalls++
    if($script:registryCalls -eq 1){return ,([object[]]@([pscustomobject]@{PSChildName=$canonicalId}))}
    return ,[object[]]@()
  }
  function WaitOwnedUninstall($installRoot,$id) { $script:waitId=$id }
  function Get-UninstallResiduals($installRoot,$id) { $script:postId=$id; return ,[object[]]@() }
  $report=@{}
  & ([scriptblock]::Create($source.Substring($begin,$end-$begin)))
  Assert ($script:waitId -eq $canonicalId -and $script:postId -eq $canonicalId) 'gate did not pass canonical identity into wait and post-check'
}

Case 'actual old install, seed, upgrade, restore statement sequence with stubs' {
  $source = [IO.File]::ReadAllText($mainPath)
  $begin = $source.IndexOf('WaitInstaller -File $old ')
  $endMarker = '$report.restore18=OpenActualLink'
  $endStart = $source.IndexOf($endMarker, $begin)
  Assert ($begin -ge 0 -and $endStart -gt $begin) 'could not find actual upgrade sequence'
  $end = $source.IndexOf("`n", $endStart)
  if ($end -lt 0) { $end = $source.Length }
  $script:events = New-Object 'System.Collections.Generic.List[string]'
  $script:appCalls = New-Object 'System.Collections.Generic.List[object]'
  function WaitInstaller($File, $Report) { [void]$script:events.Add("install:${File}") }
  function InstallRoot { return $env:TEMP }
  function Get-FileHash { param($LiteralPath,$Algorithm) return [pscustomobject]@{Hash='abc'} }
  function OpenActualLink($root,$profile,$mode,$out,$expectedVersion,$snapshot) {
    [void]$script:events.Add("app:${mode}:${expectedVersion}:${profile}:${snapshot}")
    [void]$script:appCalls.Add(@{profile=$profile; snapshot=$snapshot})
    return @{ mode=$mode }
  }
  $old='released16'; $new='current18'; $work=$env:TEMP; $report=@{}; $env:RUNNER_TEMP=$env:TEMP
  $inputs=@{ previous=@{asarSha256='abc';version='16'}; current=@{asarSha256='abc';backendSha256='abc';version='18'} }
  & ([scriptblock]::Create($source.Substring($begin, $end-$begin)))
  Assert ($script:events.Count -eq 4) "unexpected call count: $($script:events -join ', ')"
  Assert ($script:events[0] -eq 'install:released16') 'old installation order'
  Assert ($script:events[1] -like 'app:--seed:16:*') 'old app seed order/version'
  Assert ($script:events[2] -eq 'install:current18') 'upgrade order'
  Assert ($script:events[3] -like 'app:--restore:18:*') 'new app restore order/version'
  Assert ($report.seed16.mode -eq '--seed' -and $report.restore18.mode -eq '--restore') 'seed/restore outputs missing'
  Assert (($script:appCalls[0].profile -eq $script:appCalls[1].profile) -and ($script:appCalls[0].snapshot -eq $script:appCalls[1].snapshot)) 'seed/restore must share profile and snapshot'
  function OpenActualLink($root,$profile,$mode,$out,$expectedVersion,$snapshot) {
    if ($mode -eq '--restore') { throw 'simulated restore failure' }
    return @{mode=$mode}
  }
  $failed=$false
  try { & ([scriptblock]::Create($source.Substring($begin, $end-$begin))) } catch { $failed=$_.Exception.Message -eq 'simulated restore failure' }
  Assert $failed 'restore failure must propagate'
}

Case 'first-install uses shared waiter and current-user silent arguments' {
  $source = [IO.File]::ReadAllText($firstPath)
  Assert ($source -match '(?i)WaitInstaller\s+-File\s+\$Installer\s+-Report\s+\$result') 'first-install waiter or report missing'
  Assert ($source -notmatch '(?i)Start-Process\s+-FilePath\s+\$Installer\b') 'first-install bypasses shared waiter'
}

Case 'shared installer waiter behavior with isolated process stubs' {
  . $waitPath
  $script:scenario = ''; $script:cimCalls = 0; $script:launch = $null; $script:proc = $null
  function Get-CimInstance {
    param($ClassName,$ErrorAction)
    $script:cimCalls++
    if ($script:scenario -eq 'cim-fail' -or ($script:scenario -eq 'cim-fail-after-start' -and $script:cimCalls -gt 1)) { throw 'simulated CIM failure' }
    if ($script:cimCalls -eq 1) {
      if ($script:scenario -eq 'preexisting-temp') { return [pscustomobject]@{ProcessId=110;ParentProcessId=1;Name='elevate.exe';ExecutablePath=(Join-Path $env:TEMP 'elevate.exe');CreationDate='prior';CommandLine='prior'} }
      if ($script:scenario -eq 'reused-pid') { return [pscustomobject]@{ProcessId=102;ParentProcessId=1;Name='other.exe';ExecutablePath='C:\fake\other.exe';CreationDate='prior';CommandLine='private'} }
      return
    }
    $root=[pscustomobject]@{ProcessId=101;ParentProcessId=1;Name='released16.exe';ExecutablePath='C:\fake\released16.exe';CreationDate='root';CommandLine='root'}
    $child=[pscustomobject]@{ProcessId=102;ParentProcessId=101;Name='helper.exe';ExecutablePath='C:\fake\helper.exe';CreationDate='child';CommandLine='helper'}
    $grandchild=[pscustomobject]@{ProcessId=103;ParentProcessId=102;Name='child.exe';ExecutablePath='C:\fake\child.exe';CreationDate='grandchild';CommandLine='child'}
    if ($script:scenario -eq 'preexisting-temp') { return [pscustomobject]@{ProcessId=110;ParentProcessId=1;Name='elevate.exe';ExecutablePath=(Join-Path $env:TEMP 'elevate.exe');CreationDate='prior';CommandLine='prior'} }
    if ($script:scenario -eq 'new-temp') { return [pscustomobject]@{ProcessId=111;ParentProcessId=1;Name='elevate.exe';ExecutablePath=(Join-Path $env:TEMP 'elevate.exe');CreationDate='new';CommandLine='new'} }
    if ($script:scenario -eq 'parent-timeout') { return $root }
    if ($script:scenario -eq 'child-timeout') { return $grandchild,$child }
    if ($script:scenario -eq 'reused-pid') { return $child }
    if ($script:scenario -eq 'child-then-exit' -and $script:cimCalls -lt 4) { return $grandchild,$child }
  }
  function Start-Process {
    param($FilePath,$ArgumentList,[switch]$PassThru,$ErrorAction,$WindowStyle)
    $script:launch = @{FilePath=$FilePath;ArgumentList=$ArgumentList;PassThru=[bool]$PassThru;WindowStyle=$WindowStyle;BoundWindowStyle=$PSBoundParameters.ContainsKey('WindowStyle')}
    return $script:proc
  }
  function New-FakeProcess([bool]$exited,[int]$code) {
    $p=[pscustomobject]@{Id=101;HasExited=$exited;ExitCode=$code}
    $p | Add-Member -MemberType ScriptMethod -Name Refresh -Value {} -PassThru
  }
  $script:scenario='child-then-exit'; $script:cimCalls=0; $script:proc=New-FakeProcess $true 0; $r=@{}
  WaitInstaller -File 'C:\fake\released16.exe' -Report $r -TimeoutMs 500 -PollMs 5 -QuietMs 0
  Assert ($script:launch.ArgumentList -eq '/S /currentuser' -and $script:launch.PassThru -and -not $script:launch.BoundWindowStyle) 'Start-Process argument, PassThru or Hidden contract'
  Assert ($script:cimCalls -ge 4 -and $r.installerWaits[0]['status'] -eq 'PASS') 'child chain was not waited for'
  $script:scenario='child-timeout'; $script:cimCalls=0; $script:proc=New-FakeProcess $true 0; $r=@{}; $failed=$false
  try { WaitInstaller -File 'C:\fake\released16.exe' -Report $r -TimeoutMs 30 -PollMs 5 -QuietMs 0 } catch { $failed=$_.Exception.Message -match 'timeout' }
  Assert ($failed -and $r.installerWaits[0]['status'] -eq 'FAIL') 'active child must fail on timeout'
  $tree=@($r.installerWaits[0]['processTree'])
  Assert ((@($tree | Where-Object {$_['pid'] -eq 102})).Count -eq 1 -and (@($tree | Where-Object {$_['pid'] -eq 103})).Count -eq 1) 'timeout tree must include both child generations'
  Assert (-not $tree[0].Contains('commandLine')) 'process report must not expose command line'
  Assert ($r.installerWaits[0]['timeoutMs'] -eq 30 -and $r.installerWaits[0]['elapsedMs'] -lt 2000) 'timeout must be bounded and reported'
  $script:scenario='parent-timeout'; $script:cimCalls=0; $script:proc=New-FakeProcess $false 0; $r=@{}; $failed=$false
  try { WaitInstaller -File 'C:\fake\released16.exe' -Report $r -TimeoutMs 30 -PollMs 5 -QuietMs 0 } catch { $failed=$_.Exception.Message -match 'timeout' }
  Assert ($failed -and (@($r.installerWaits[0]['processTree'] | Where-Object {$_['pid'] -eq 101})).Count -eq 1) 'live launcher timeout must include process tree'
  $script:scenario='normal'; $script:cimCalls=0; $script:proc=New-FakeProcess $true 7; $r=@{}; $failed=$false
  try { WaitInstaller -File 'C:\fake\released16.exe' -Report $r -TimeoutMs 30 -PollMs 5 -QuietMs 0 } catch { $failed=$_.Exception.Message -match 'exit 7' }
  Assert ($failed -and $r.installerWaits[0]['status'] -eq 'FAIL') 'nonzero launcher exit must fail'
  $script:scenario='cim-fail'; $script:cimCalls=0; $script:launch=$null; $script:proc=New-FakeProcess $true 0; $r=@{}; $failed=$false
  try { WaitInstaller -File 'C:\fake\released16.exe' -Report $r -TimeoutMs 30 -PollMs 5 -QuietMs 0 } catch { $failed=$_.Exception.Message -match 'simulated CIM failure' }
  Assert ($failed -and $null -eq $script:launch -and $r.installerWaits[0]['status'] -eq 'FAIL') 'CIM failure must stop before launching'
  $script:scenario='cim-fail-after-start'; $script:cimCalls=0; $script:launch=$null; $script:proc=New-FakeProcess $true 0; $r=@{}; $failed=$false
  try { WaitInstaller -File 'C:\fake\released16.exe' -Report $r -TimeoutMs 30 -PollMs 5 -QuietMs 0 } catch { $failed=$_.Exception.Message -match 'simulated CIM failure' }
  Assert ($failed -and $null -ne $script:launch -and $r.installerWaits[0]['status'] -eq 'FAIL') 'CIM failure after launch must fail'
  $script:scenario='preexisting-temp'; $script:cimCalls=0; $script:proc=New-FakeProcess $true 0; $r=@{}
  WaitInstaller -File 'C:\fake\released16.exe' -Report $r -TimeoutMs 100 -PollMs 5 -QuietMs 0
  Assert ($r.installerWaits[0]['status'] -eq 'PASS') 'preexisting temp process must not be treated as owned'
  $script:scenario='new-temp'; $script:cimCalls=0; $script:proc=New-FakeProcess $true 0; $r=@{}; $failed=$false
  try { WaitInstaller -File 'C:\fake\released16.exe' -Report $r -TimeoutMs 30 -PollMs 5 -QuietMs 0 } catch { $failed=$_.Exception.Message -match 'timeout' }
  Assert ($failed -and (@($r.installerWaits[0]['processTree'] | Where-Object {$_['pid'] -eq 111})).Count -eq 1) 'new temp elevation candidate must be waited for and reported'
  $script:scenario='reused-pid'; $script:cimCalls=0; $script:proc=New-FakeProcess $true 0; $r=@{}; $failed=$false
  try { WaitInstaller -File 'C:\fake\released16.exe' -Report $r -TimeoutMs 30 -PollMs 5 -QuietMs 0 } catch { $failed=$_.Exception.Message -match 'timeout' }
  Assert ($failed -and (@($r.installerWaits[0]['processTree'] | Where-Object {$_['pid'] -eq 102 -and $_['creationDate'] -eq 'child'})).Count -eq 1) 'new child using prior PID must be waited for and reported'
  $source=[IO.File]::ReadAllText($waitPath)
  Assert ($source -match '(?i)\$TimeoutMs\s*=\s*300000') 'production timeout default must be 300000ms'
}

Write-Output ("Engine: {0} {1}" -f $PSVersionTable.PSEdition, $PSVersionTable.PSVersion)

# Shared by both acceptance controllers. Only run on the disposable runner.
function WaitInstaller {
  param(
    [Parameter(Mandatory=$true)][string]$File,
    [Parameter(Mandatory=$true)][System.Collections.IDictionary]$Report,
    [int]$TimeoutMs = 300000,
    [int]$PollMs = 250,
    [int]$QuietMs = 1000
  )
  if($TimeoutMs -le 0 -or $PollMs -le 0 -or $QuietMs -lt 0){throw 'Invalid installer wait limits'}
  $record=[ordered]@{file=$File; arguments='/S /currentuser'; timeoutMs=$TimeoutMs; status='RUNNING'; processTree=@(); attribution='observed descendants and newly appearing matching temporary installer candidates; not a proof of all descendants'}
  if(-not $Report.Contains('installerWaits')){$Report['installerWaits']=@()}
  $Report['installerWaits']+=@($record)
  $clock=[Diagnostics.Stopwatch]::StartNew()
  $seen=@{}; $before=@{}; $lastTree=@(); $process=$null; $rootExit=$null; $quietSince=$null
  try {
    # Fail closed when process inventory is unavailable. Do not kill unrelated processes.
    foreach($row in @(Get-CimInstance Win32_Process -ErrorAction Stop)){$before[[string]$row.ProcessId]=[string]$row.CreationDate}
    $process=Start-Process -FilePath $File -ArgumentList '/S /currentuser' -PassThru -ErrorAction Stop
    $rootId=[string]$process.Id
    $leaf=[IO.Path]::GetFileName($File)
    $tempRoots=@($env:TEMP,(Join-Path $env:LOCALAPPDATA 'Temp')) | Where-Object {$_} | ForEach-Object {[IO.Path]::GetFullPath($_).TrimEnd([char]92)+'\'}
    do {
      $rows=@(Get-CimInstance Win32_Process -ErrorAction Stop)
      $rootRow=@($rows | Where-Object {[string]$_.ProcessId -eq $rootId})
      if($rootRow.Count -and -not $seen.ContainsKey($rootId)){$seen[$rootId]=[string]$rootRow[0].CreationDate}
      # Iterate until transitive children have been found, independent of CIM enumeration order.
      do {
        $changed=$false
        foreach($row in $rows){
          $id=[string]$row.ProcessId; $parent=[string]$row.ParentProcessId
          $created=[string]$row.CreationDate
          if(($seen.ContainsKey($id) -and $seen[$id] -eq $created) -or ($before.ContainsKey($id) -and $before[$id] -eq $created)){continue}
          $parentRow=@($rows | Where-Object {[string]$_.ProcessId -eq $parent} | Select-Object -First 1)
          $isChild=($parent -eq $rootId -or ($seen.ContainsKey($parent) -and ($parentRow.Count -eq 0 -or $seen[$parent] -eq [string]$parentRow[0].CreationDate)))
          $isTemp=$false
          if($row.ExecutablePath){foreach($prefix in $tempRoots){if($row.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){$isTemp=$true;break}}}
          $isCandidate=$isTemp -and ($row.Name -ieq $leaf -or $row.Name -match '(?i)^(ns.*\.exe|elevate\.exe|~ns.*\.tmp)$')
          if($isChild -or $isCandidate){$seen[$id]=$created;$changed=$true}
        }
      } while($changed)
      $lastTree=@($rows | Where-Object { $id=[string]$_.ProcessId; $seen.ContainsKey($id) -and $seen[$id] -eq [string]$_.CreationDate } | ForEach-Object {
        [ordered]@{pid=$_.ProcessId; parentPid=$_.ParentProcessId; name=$_.Name; executablePath=$_.ExecutablePath; creationDate=[string]$_.CreationDate}
      })
      $process.Refresh()
      if($process.HasExited -and $null -eq $rootExit){$rootExit=$process.ExitCode; $record['launcherExitCode']=$rootExit; if($null -eq $rootExit -or $rootExit -ne 0){throw ('Installer launcher exit '+$rootExit)}}
      $active=@($lastTree | Where-Object {[string]$_['pid'] -ne $rootId})
      if($clock.ElapsedMilliseconds -ge $TimeoutMs){$record['processTree']=$lastTree;throw 'Owned installer timeout'}
      if($process.HasExited -and $active.Count -eq 0){
        if($null -eq $quietSince){$quietSince=$clock.ElapsedMilliseconds}
        if(($clock.ElapsedMilliseconds - $quietSince) -ge $QuietMs){$record['status']='PASS';return}
      } else {$quietSince=$null}
      Start-Sleep -Milliseconds ([Math]::Min($PollMs,[Math]::Max(1,$TimeoutMs-$clock.ElapsedMilliseconds)))
    } while($true)
  } catch {
    $record['status']='FAIL';$record['processTree']=$lastTree;$record['failure']=$_.Exception.Message
    throw
  } finally {$record['elapsedMs']=$clock.ElapsedMilliseconds; $clock.Stop()}
}

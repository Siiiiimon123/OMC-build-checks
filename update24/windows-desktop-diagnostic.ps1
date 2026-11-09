param([Parameter(Mandatory=$true)][string]$Executable,
      [Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:GITHUB_REPOSITORY -ne 'Siiiiimon123/OMC-build-checks' -or
   $env:GITHUB_REF -ne 'refs/heads/verify-update24-win-accept'){
  throw 'Owned disposable runner only'
}
$expected=[IO.Path]::GetFullPath($Executable)
$shell=New-Object -ComObject WScript.Shell
$rootCandidates=@(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('DesktopDirectory'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  (Join-Path $env:USERPROFILE 'Desktop'),
  (Join-Path $env:PUBLIC 'Desktop')
)
$rootCandidates=@($rootCandidates | Where-Object {$_} | Select-Object -Unique)
$links=@()
foreach($directory in $rootCandidates){
  if(-not (Test-Path -LiteralPath $directory -PathType Container)){continue}
  foreach($file in @(Get-ChildItem -LiteralPath $directory -Filter '*.lnk' -File)){
    $target=$shell.CreateShortcut($file.FullName)
    if(-not $target.TargetPath){continue}
    if(-not [IO.Path]::GetFullPath($target.TargetPath).Equals($expected,[StringComparison]::OrdinalIgnoreCase)){continue}
    $links += [ordered]@{path=$file.FullName;target=$target.TargetPath;icon=$target.IconLocation;
      iconMatches=$target.IconLocation.StartsWith($expected,[StringComparison]::OrdinalIgnoreCase)}
  }
}
$logs=@()
foreach($directory in @($env:TEMP,$env:TMP,[IO.Path]::GetTempPath()) | Select-Object -Unique){
  if(-not $directory -or -not (Test-Path -LiteralPath $directory)){continue}
  foreach($file in @(Get-ChildItem -LiteralPath $directory -Filter 'omc-preview16-shortcut-*.log' -File | Select-Object -First 5)){
    if($file.Length -le 16384){$logs += [ordered]@{file=$file.Name;text=(Get-Content -LiteralPath $file.FullName -Raw)}}
  }
}
[ordered]@{roots=$rootCandidates;matches=@($links);installerShortcutLogs=@($logs);
  validDesktopShortcut=(@($links | Where-Object iconMatches).Count -eq 1)} |
  ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding UTF8

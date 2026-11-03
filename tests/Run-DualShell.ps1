param(
  [string]$WindowsPowerShell = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'),
  [string]$Pwsh = 'C:\Users\L\Desktop\eighth-ps1-work\pwsh-7.6.9\pwsh.exe'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Pwsh)) {
  $command = Get-Command pwsh.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { $Pwsh = $command.Source }
}
foreach ($engine in @(@{path=$WindowsPowerShell; edition='Desktop'; major=5}, @{path=$Pwsh; edition='Core'; major=7})) {
  if (-not (Test-Path -LiteralPath $engine.path)) { throw "Required engine missing: $($engine.path)" }
  $versionInfo = & $engine.path -NoProfile -NonInteractive -Command '$PSVersionTable.PSEdition; $PSVersionTable.PSVersion.Major; $PSVersionTable.PSVersion.ToString()'
  if ($LASTEXITCODE -ne 0) { throw "Cannot inspect engine: $($engine.path)" }
  if ($versionInfo.Count -ne 3 -or $versionInfo[0] -ne $engine.edition -or [int]$versionInfo[1] -ne $engine.major) { throw "Wrong engine/version: $($engine.path) $versionInfo" }
  Write-Output "=== $($engine.path) $($versionInfo[2]) ==="
  & $engine.path -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Test-CallerPath.ps1')
  if ($LASTEXITCODE -ne 0) { throw "Caller-path tests failed: $($engine.path)" }
}
Write-Output 'PASS both required PowerShell engines'

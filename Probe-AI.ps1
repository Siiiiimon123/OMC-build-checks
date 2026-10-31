$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:GITHUB_REPOSITORY -ne 'Siiiiimon123/OMC-build-checks' -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -ne 'Arm64'){throw 'Approved disposable ARM64 Windows runner only'}
$reportPath=Join-Path $env:RUNNER_TEMP 'omc-arm-backend-report.json'
$result=[ordered]@{status='RUNNING';physicalKirinOrStratoVirtQualified=$false;harmonyNativeQualified=$false;syntheticFixturesOnly=$true;memberDataUsed=$false;dependenciesInstalled=$false;tokensDisclosed=$false}
$proc=$null;$failure=$null
try {
  $install=Get-Content -LiteralPath (Join-Path $env:RUNNER_TEMP 'omc-first-install-report.json') -Raw|ConvertFrom-Json
  if(!$install.canonicalInstallExecuted -or !$install.installedAsarMatches){throw 'Verified installation required before backend probe'}
  $root=$install.installRoot
  $rootPrefix=$root.TrimEnd([char]92)+'\'
  $active=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($rootPrefix,[StringComparison]::OrdinalIgnoreCase)})
  if($active.Count){throw 'Installed App still has active processes; separate backend probe refused'}
  $result.firstStartupGatePassed=($install.status -eq 'PASS_SCOPED_CANONICAL_FIRST_INSTALL_AND_DEFAULT_STARTUP' -and $install.normalExitVerified)
  $serviceRoot=Join-Path $root 'resources\ai-service'
  $serviceExe=Join-Path $serviceRoot 'ai-service.exe'
  if(!(Test-Path -LiteralPath $serviceExe -PathType Leaf)){throw 'Bundled AI service missing'}
  $result.serviceSha256=(Get-FileHash -LiteralPath $serviceExe -Algorithm SHA256).Hash.ToLowerInvariant()
  if($result.serviceSha256 -ne '0351c4607980153cdb6de6760e3f20413a217948fd0ca6c0610deb9d725d36ba'){throw 'Installed AI executable does not match the approved current build'}
  $work=Join-Path $env:RUNNER_TEMP ('omc-arm-ai-'+[Guid]::NewGuid().ToString('N'))
  [void](New-Item -ItemType Directory -Path $work)
  $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
  $token=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
  $prepareToken=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
  $psi=[Diagnostics.ProcessStartInfo]::new($serviceExe)
  $psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.WorkingDirectory=$serviceRoot
  foreach($key in @('PYTHONHOME','PYTHONPATH','VIRTUAL_ENV','CONDA_PREFIX','NODE_PATH','NODE_OPTIONS')){[void]$psi.Environment.Remove($key)}
  $psi.Environment['PATH']=Join-Path $env:SystemRoot 'System32'
  $psi.Environment['OMC_AI_TOKEN']=$token;$psi.Environment['OMC_AI_PREPARE_TOKEN']=$prepareToken
  $psi.Environment['OMC_AI_LIFECYCLE_KEY']=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
  $psi.Environment['OMC_AI_PORT']=[string]$port;$psi.Environment['OMC_AI_DATA_DIR']=Join-Path $work 'dataset'
  [void]$psi.Environment.Remove('OMC_AI_DML_DEVICE_ID')
  $psi.Environment['OMC_RETAIN_NATIVE_ORT_PROFILES_FOR_EVIDENCE']='0'
  $proc=[Diagnostics.Process]::Start($psi)
  $base='http://127.0.0.1:'+$port;$headers=@{Authorization='Bearer '+$token}
  $deadline=[DateTime]::UtcNow.AddSeconds(90);$health=$null
  while([DateTime]::UtcNow -lt $deadline){
    $proc.Refresh();if($proc.HasExited){throw ('Bundled AI exited before health: '+$proc.ExitCode)}
    try {$health=Invoke-RestMethod -Uri ($base+'/health') -Headers $headers -TimeoutSec 3;if($health.status -eq 'ok'){break}}catch{}
    Start-Sleep -Milliseconds 500
  }
  if(!$health -or $health.status -ne 'ok'){throw 'Bundled AI health timed out'}
  $prepareHeaders=@{Authorization='Bearer '+$token;'X-OMC-Prepare-Capability'=$prepareToken}
  # Exercise the real default Windows ARM compatibility route, with no forced adapter override.
  # This does not qualify the physical Kirin GPU or its virtual-machine driver.
  $body=@{trigger='T_ai';requested_at_epoch_ms=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();host_runtime=@{platform='win32';arch='x64';os_release='Windows';os_version=[Environment]::OSVersion.Version.ToString();native_dxgi_adapters=@()}}|ConvertTo-Json -Depth 5
  $accepted=Invoke-RestMethod -Method Post -Uri ($base+'/runtime/prepare') -Headers $prepareHeaders -ContentType 'application/json' -Body $body -TimeoutSec 15
  if(!$accepted.accepted){throw 'Bundled AI did not accept normal runtime preparation'}
  $deadline=[DateTime]::UtcNow.AddSeconds(360);$info=$null
  while([DateTime]::UtcNow -lt $deadline){
    $proc.Refresh();if($proc.HasExited){throw ('Bundled AI exited during preparation: '+$proc.ExitCode)}
    $info=Invoke-RestMethod -Uri ($base+'/info') -Headers $headers -TimeoutSec 10
    if($info.service.full_ai_ready){break}
    if($info.service.state -in @('error','circuit-open','degraded')){throw ('AI preparation failed: '+$info.service.state)}
    Start-Sleep -Seconds 2
  }
  if(!$info.service.full_ai_ready -or !$info.clip_available -or !$info.technical_model.loaded -or !$info.content_model.loaded -or !$info.quality_reference.loaded){throw 'Full bundled core AI models were not ready'}
  $result.provider=$info.provider;$result.runtime=$info.runtime
  $result.coreModelsReady=$true;$result.cpuScenario='Default Windows ARM compatibility route; no adapter override'
  if($info.provider -ne 'CPUExecutionProvider'){throw 'CPU fallback was not actually observed'}
  if($info.runtime.reason_code -ne 'WINDOWS_ARM_X64_CPU_COMPATIBILITY'){throw 'The default Windows ARM compatibility route was not observed'}
  Add-Type -AssemblyName System.Drawing
  $result.analyses=@()
  foreach($index in 0,1){
    $path=Join-Path $work ('fixture-'+$index+'.jpg')
    $bitmap=[Drawing.Bitmap]::new(320,240);$graphics=[Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([Drawing.Color]::FromArgb(35+60*$index,90,130))
      for($n=0;$n -lt 12;$n++){$brush=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(20+17*$n,40+11*$n,230-15*$n));try{$graphics.FillRectangle($brush,($n*27)%320,($n*37)%240,31+$index*13,37)}finally{$brush.Dispose()}}
      $bitmap.Save($path,[Drawing.Imaging.ImageFormat]::Jpeg)
    }finally{$graphics.Dispose();$bitmap.Dispose()}
    $timer=[Diagnostics.Stopwatch]::StartNew()
    $analysis=Invoke-RestMethod -Method Post -Uri ($base+'/analyze/photo') -Headers $headers -Form @{image=Get-Item -LiteralPath $path;cache_namespace=('arm-cpu-'+[Guid]::NewGuid().ToString('N'))} -TimeoutSec 120
    $timer.Stop()
    if(!$analysis.available -or !$analysis.technical.available -or !$analysis.technical.qualityReference.available){throw 'Combined real inference or TOPIQ reference unavailable'}
    $defects=@($analysis.technical.defectProbabilities.PSObject.Properties)
    if($defects.Count -ne 7){throw 'Seven technical defect outputs required'}
    $numericTypes=@([byte],[sbyte],[short],[ushort],[int],[uint],[long],[ulong],[float],[double],[decimal],[Numerics.BigInteger])
    foreach($entry in $defects){
      if($null -eq $entry.Value -or $entry.Value.GetType() -notin $numericTypes){throw 'Technical probability must be a JSON number'}
      $v=[double]$entry.Value
      if([double]::IsNaN($v) -or [double]::IsInfinity($v) -or $v -lt 0 -or $v -gt 1){throw 'Invalid technical probability'}
    }
    $result.analyses+=@{fixture=$index;available=$true;technicalOutputs=$defects.Count;topiqAvailable=$true;elapsedMilliseconds=$timer.ElapsedMilliseconds;responseSections=@($analysis.PSObject.Properties.Name)}
  }
  $result.status='PASS_BUNDLED_X64_AI_ON_WINDOWS_ARM_CPU_SCENARIO'
}catch {$failure=$_;$result.status='FAIL_BUNDLED_AI_ON_WINDOWS_ARM';$result.failure=$_.Exception.Message}
finally {
  if($proc){
    $proc.Refresh()
    if(!$proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue;$proc.WaitForExit(10000)|Out-Null}
    $proc.Refresh();$result.ownedProbeProcessStopped=$proc.HasExited
    if(!$proc.HasExited){$result.status='FAIL_PROBE_CLEANUP';if(!$failure){$failure='Owned AI probe process remained alive'}}
  }
  $result|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $reportPath -Encoding utf8
  $token=$null;$prepareToken=$null
}
if($failure){throw $failure}

param(
  [ValidateRange(1024,65535)][int]$Port = 4186,
  [string]$DataDir = $env:DEMO_DATA_DIR,
  [switch]$Build
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workerRoot = Join-Path $projectRoot 'spring-ai-worker'
$toolRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '..\.tools\java-demo'))
$java = Join-Path $toolRoot 'jdk-21.0.12.1+1\bin\java.exe'
$jar = Join-Path $workerRoot 'target\spring-ai-worker-1.0.0.jar'
$node = 'D:\NodeJs\node.exe'
if (!(Test-Path -LiteralPath $node)) { $node = (Get-Command node.exe -ErrorAction Stop).Source }
if ($Build) { & (Join-Path $workerRoot 'build.ps1'); if ($LASTEXITCODE -ne 0) { throw 'Spring AI build failed.' } }
if (!(Test-Path -LiteralPath $java) -or !(Test-Path -LiteralPath $jar)) { throw 'Portable Java or worker JAR missing. Run spring-ai-worker/build.ps1 first.' }

# Refuse to disturb an existing listener; only stop the child created below.
foreach ($checkPort in @($Port,4192)) {
  $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$checkPort)
  try { $probe.Start() } catch { throw "Port $checkPort is already in use. Stop the intended service before switching engines." }
  finally { $probe.Stop() }
}
$savedToken = $env:WORKBENCH_BRIDGE_TOKEN
$savedEngine = $env:QA_AI_ENGINE
$savedPort = $env:DEMO_PORT
$savedData = $env:DEMO_DATA_DIR
$worker = $null
$runtimeDir = Join-Path $toolRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
try {
  if ([string]::IsNullOrEmpty($env:WORKBENCH_BRIDGE_TOKEN)) {
    $random = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    $env:WORKBENCH_BRIDGE_TOKEN = ([BitConverter]::ToString($random)).Replace('-','').ToLowerInvariant()
  }
  if ($env:WORKBENCH_BRIDGE_TOKEN -notmatch '^[A-Za-z0-9._~-]{32,256}$') { throw 'Bridge token must contain 32 to 256 safe characters.' }
  $env:QA_AI_ENGINE = 'spring-ai'
  $env:DEMO_PORT = [string]$Port
  if ($DataDir) { $env:DEMO_DATA_DIR = [IO.Path]::GetFullPath($DataDir) }
  $launchArguments = @("-Djava.io.tmpdir=`"$runtimeDir`"", '-jar', "`"$jar`"")
  $worker = Start-Process -FilePath $java -ArgumentList $launchArguments -WorkingDirectory $workerRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'spring-ai-worker.out.log') -RedirectStandardError (Join-Path $runtimeDir 'spring-ai-worker.err.log')
  $ready = $false
  for ($attempt=0; $attempt -lt 100; $attempt++) {
    if ($worker.HasExited) { throw 'Spring AI worker exited during startup. See .tools/java-demo/runtime startup logs.' }
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4192/internal/health' -Headers @{'X-Bridge-Token'=$env:WORKBENCH_BRIDGE_TOKEN} -TimeoutSec 1
      if ($health.status -eq 'ok' -and $health.engine -eq 'spring-ai') { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 200
  }
  if (!$ready) { throw 'Spring AI worker did not become ready; no model call was attempted.' }
  Write-Host "Spring AI $($health.springAiVersion) ready on 127.0.0.1:4192. Workbench: http://127.0.0.1:$Port"
  & $node (Join-Path $projectRoot 'server.mjs')
  $nodeExitCode = $LASTEXITCODE
} finally {
  if ($worker -and !$worker.HasExited) { Stop-Process -Id $worker.Id -ErrorAction SilentlyContinue }
  $env:WORKBENCH_BRIDGE_TOKEN = $savedToken
  $env:QA_AI_ENGINE = $savedEngine
  $env:DEMO_PORT = $savedPort
  $env:DEMO_DATA_DIR = $savedData
}
if ($null -ne $nodeExitCode -and $nodeExitCode -ne 0) { exit $nodeExitCode }

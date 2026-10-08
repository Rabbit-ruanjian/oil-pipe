$ErrorActionPreference = 'Stop'

$env:AUTH_REQUIRED_IN_PRODUCTION = 'false'
$env:API_WORKERS = '1'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$agentDir = Join-Path $rootDir 'pipeline-agent'
$pythonExe = 'C:\Users\hxrzy\Anaconda3\envs\pipeline-agent311\python.exe'

if (-not (Test-Path $agentDir)) {
  throw "Agent directory not found: $agentDir"
}

if (-not (Test-Path $pythonExe)) {
  throw "Python runtime not found: $pythonExe"
}

Set-Location $agentDir
& $pythonExe 'main.py'

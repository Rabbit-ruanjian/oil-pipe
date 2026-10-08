@echo off
setlocal

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "LOGDIR=%ROOT%\run-logs"
set "RUNNER=%ROOT%\scripts\run-local-agent.ps1"

if not exist "%LOGDIR%" mkdir "%LOGDIR%"
if not exist "%RUNNER%" (
  echo Agent runner script not found: %RUNNER%
  exit /b 1
)

start "pipeline-agent" /B powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%RUNNER%" 1>"%LOGDIR%\pipeline-agent.out.log" 2>"%LOGDIR%\pipeline-agent.err.log"

endlocal

@echo off
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs

start "pipeline-auth" /b cmd.exe /c call "%~dp0run-auth.cmd"
start "pipeline-data" /b cmd.exe /c call "%~dp0run-data.cmd"
start "pipeline-system" /b cmd.exe /c call "%~dp0run-system.cmd"
start "pipeline-calculation" /b cmd.exe /c call "%~dp0run-calculation.cmd"
start "pipeline-gateway" /b cmd.exe /c call "%~dp0run-gateway.cmd"

echo backend start commands submitted

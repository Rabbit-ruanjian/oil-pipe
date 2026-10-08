@echo off
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs

start "pipeline-auth" /D "%~dp0" /B cmd /c ""%~dp0run-auth-j21.cmd""
start "pipeline-system" /D "%~dp0" /B cmd /c ""%~dp0run-system-j21.cmd""
start "pipeline-data" /D "%~dp0" /B cmd /c ""%~dp0run-data-j21.cmd""
start "pipeline-calculation" /D "%~dp0" /B cmd /c ""%~dp0run-calculation-j21.cmd""
start "pipeline-gateway" /D "%~dp0" /B cmd /c ""%~dp0run-gateway-j21.cmd""

echo backend j21 start commands submitted

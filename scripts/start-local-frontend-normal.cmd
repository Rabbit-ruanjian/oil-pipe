@echo off
setlocal

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "LOGDIR=%ROOT%\run-logs"

if not exist "%LOGDIR%" mkdir "%LOGDIR%"

start "pipeline-react" /D "%ROOT%\pipeline-react" /B cmd /c "set VITE_AGENT_API_BASE_URL=http://127.0.0.1:8100/api/v1&&npm.cmd run dev -- --host 0.0.0.0 1>"%LOGDIR%\pipeline-react-normal.out.log" 2>"%LOGDIR%\pipeline-react-normal.err.log""

endlocal

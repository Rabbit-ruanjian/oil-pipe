@echo off
setlocal

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "LOGDIR=%ROOT%\run-logs"

if not exist "%LOGDIR%" mkdir "%LOGDIR%"

start "pipeline-react" /D "%ROOT%\pipeline-react" /B cmd /c "npm.cmd run dev -- --host 0.0.0.0 1>"%LOGDIR%\pipeline-react.out.log" 2>"%LOGDIR%\pipeline-react.err.log""

endlocal

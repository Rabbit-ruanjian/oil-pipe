@echo off
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
E:\JDK17\bin\java.exe -jar "%~dp0pipeline-gateway\target\pipeline-gateway-1.0.0-SNAPSHOT.jar" ^
  >> "%~dp0logs\gateway-live.log" 2>>&1

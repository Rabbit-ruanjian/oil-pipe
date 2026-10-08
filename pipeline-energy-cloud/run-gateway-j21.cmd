@echo off
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
"C:\Program Files\JetBrains\IntelliJ IDEA 2025.1.3\jbr\bin\java.exe" -jar "%~dp0pipeline-gateway\target\pipeline-gateway-1.0.0-SNAPSHOT.jar" ^
  --server.port=8080 ^
  >> "%~dp0logs\gateway-live.log" 2>>&1

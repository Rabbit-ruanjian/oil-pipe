@echo off
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
set PIPELINE_DB_HOST=127.0.0.1
set PIPELINE_DB_PORT=3306
set PIPELINE_DB_USERNAME=root
set PIPELINE_DB_PASSWORD=root
"C:\Program Files\JetBrains\IntelliJ IDEA 2025.1.3\jbr\bin\java.exe" -jar "%~dp0pipeline-data\target\pipeline-data-1.0.0-SNAPSHOT.jar" ^
  >> "%~dp0logs\data-live.log" 2>>&1

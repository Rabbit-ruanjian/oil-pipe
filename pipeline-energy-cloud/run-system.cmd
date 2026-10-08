@echo off
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
E:\JDK17\bin\java.exe -jar "%~dp0pipeline-system\target\pipeline-system-1.0.0-SNAPSHOT.jar" ^
  --spring.datasource.url=jdbc:mysql://localhost:3306/pipeline_cloud ^
  --spring.datasource.username=root ^
  --spring.datasource.password=123456 ^
  >> "%~dp0logs\system-live.log" 2>>&1

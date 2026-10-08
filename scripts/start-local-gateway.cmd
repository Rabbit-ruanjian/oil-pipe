@echo off
setlocal

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "JAVA=C:\Program Files\JetBrains\IntelliJ IDEA 2025.1.3\jbr\bin\java.exe"
set "LOGDIR=%ROOT%\run-logs"
set "GATEWAY_CONFIG=file:%ROOT:\=/%/scripts/gateway-local.yml"

if not exist "%LOGDIR%" mkdir "%LOGDIR%"
if not exist "%JAVA%" (
  echo Java 21 runtime not found: %JAVA%
  exit /b 1
)

start "pipeline-gateway" /D "%ROOT%\pipeline-energy-cloud\pipeline-gateway" /B cmd /c ""%JAVA%" -Dfile.encoding=UTF-8 -jar target\pipeline-gateway-1.0.0-SNAPSHOT.jar --spring.config.location=%GATEWAY_CONFIG% 1>"%LOGDIR%\pipeline-gateway.out.log" 2>"%LOGDIR%\pipeline-gateway.err.log""

endlocal

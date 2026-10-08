@echo off
setlocal

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "JAVA=C:\Program Files\JetBrains\IntelliJ IDEA 2025.1.3\jbr\bin\java.exe"
set "LOGDIR=%ROOT%\run-logs"
set "DB_URL=jdbc:mysql://127.0.0.1:3307/pipeline_cloud?useUnicode=true^&characterEncoding=utf8^&zeroDateTimeBehavior=convertToNull^&useSSL=false^&allowPublicKeyRetrieval=true^&serverTimezone=GMT%%2B8"
set "DB_PASSWORD=hy123123"
set "GATEWAY_CONFIG=file:%ROOT:\=/%/scripts/gateway-local.yml"

if not exist "%LOGDIR%" mkdir "%LOGDIR%"
if not exist "%JAVA%" (
  echo Java 21 runtime not found: %JAVA%
  exit /b 1
)

echo Starting Java services...

start "pipeline-auth" /D "%ROOT%\pipeline-energy-cloud\pipeline-auth" /B cmd /c ""%JAVA%" -Dfile.encoding=UTF-8 -jar target\pipeline-auth-1.0.0-SNAPSHOT.jar --spring.datasource.url=%DB_URL% --spring.datasource.username=root --spring.datasource.password=%DB_PASSWORD% --spring.cloud.nacos.discovery.enabled=false --spring.cloud.nacos.config.enabled=false 1>"%LOGDIR%\pipeline-auth.out.log" 2>"%LOGDIR%\pipeline-auth.err.log""

start "pipeline-system" /D "%ROOT%\pipeline-energy-cloud\pipeline-system" /B cmd /c ""%JAVA%" -Dfile.encoding=UTF-8 -jar target\pipeline-system-1.0.0-SNAPSHOT.jar --spring.datasource.url=%DB_URL% --spring.datasource.username=root --spring.datasource.password=%DB_PASSWORD% --spring.cloud.nacos.discovery.enabled=false --spring.cloud.nacos.config.enabled=false 1>"%LOGDIR%\pipeline-system.out.log" 2>"%LOGDIR%\pipeline-system.err.log""

start "pipeline-data" /D "%ROOT%\pipeline-energy-cloud\pipeline-data" /B cmd /c ""%JAVA%" -Dfile.encoding=UTF-8 -jar target\pipeline-data-1.0.0-SNAPSHOT.jar --spring.datasource.url=%DB_URL% --spring.datasource.username=root --spring.datasource.password=%DB_PASSWORD% --spring.cloud.nacos.discovery.enabled=false --spring.cloud.nacos.config.enabled=false 1>"%LOGDIR%\pipeline-data.out.log" 2>"%LOGDIR%\pipeline-data.err.log""

start "pipeline-calculation" /D "%ROOT%\pipeline-energy-cloud\pipeline-calculation" /B cmd /c ""%JAVA%" -Dfile.encoding=UTF-8 -jar target\pipeline-calculation-1.0.0-SNAPSHOT.jar --spring.datasource.url=%DB_URL% --spring.datasource.username=root --spring.datasource.password=%DB_PASSWORD% --spring.cloud.nacos.discovery.enabled=false --spring.cloud.nacos.config.enabled=false 1>"%LOGDIR%\pipeline-calculation.out.log" 2>"%LOGDIR%\pipeline-calculation.err.log""

start "pipeline-gateway" /D "%ROOT%\pipeline-energy-cloud\pipeline-gateway" /B cmd /c ""%JAVA%" -Dfile.encoding=UTF-8 -jar target\pipeline-gateway-1.0.0-SNAPSHOT.jar --spring.config.location=%GATEWAY_CONFIG% --server.port=8081 1>"%LOGDIR%\pipeline-gateway.out.log" 2>"%LOGDIR%\pipeline-gateway.err.log""

echo Starting React frontend...
start "pipeline-react" /D "%ROOT%\pipeline-react" /B cmd /c "npm.cmd run dev -- --host 0.0.0.0 1>"%LOGDIR%\pipeline-react.out.log" 2>"%LOGDIR%\pipeline-react.err.log""

echo Startup commands dispatched.
endlocal

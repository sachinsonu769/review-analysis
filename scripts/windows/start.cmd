@echo off
setlocal EnableExtensions
pushd "%~dp0..\.." || exit /b 1
where docker >nul 2>&1
if errorlevel 1 goto docker_missing
docker info >nul 2>&1
if errorlevel 1 goto docker_stopped
docker info --format "{{.OSType}}" | findstr /x /c:"linux" >nul
if errorlevel 1 goto linux_required
docker compose version >nul 2>&1
if errorlevel 1 goto compose_missing
if not exist "review-analysis-image.tar.gz" goto inspect_image
echo Loading the bundled Review Analysis image...
docker load --input "review-analysis-image.tar.gz"
if errorlevel 1 goto failed
:inspect_image
docker image inspect review-analysis:0.2.0 >nul 2>&1
if errorlevel 1 goto image_missing
echo Starting Review Analysis...
docker compose up --detach --wait --wait-timeout 90 --pull never
if errorlevel 1 goto startup_failed
echo Review Analysis is ready at http://127.0.0.1:8787
start "" "http://127.0.0.1:8787"
popd
exit /b 0
:docker_missing
echo Install Docker Desktop, then run this launcher again.
goto failed
:docker_stopped
echo Start Docker Desktop and wait until its engine is ready.
goto failed
:linux_required
echo Switch Docker Desktop to Linux containers, then run this launcher again.
goto failed
:compose_missing
echo Docker Compose v2 is required and is included with Docker Desktop.
goto failed
:image_missing
echo The bundled review-analysis-image.tar.gz is missing and the app image is not loaded.
echo Extract the complete Windows bundle, then run this launcher again.
goto failed
:startup_failed
docker compose logs --tail 30 app
:failed
popd
pause
exit /b 1

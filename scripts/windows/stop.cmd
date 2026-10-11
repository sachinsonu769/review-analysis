@echo off
setlocal EnableExtensions
pushd "%~dp0..\.." || exit /b 1
docker compose down
set "result=%ERRORLEVEL%"
popd
if not "%result%"=="0" pause
exit /b %result%

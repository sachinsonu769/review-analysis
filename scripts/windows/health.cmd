@echo off
setlocal EnableExtensions
pushd "%~dp0..\.." || exit /b 1
docker compose exec -T app node -e "fetch('http://127.0.0.1:8787/health',{signal:AbortSignal.timeout(5000)}).then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})"
set "result=%ERRORLEVEL%"
popd
pause
exit /b %result%

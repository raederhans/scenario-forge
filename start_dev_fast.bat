@echo off
setlocal
cd /d "%~dp0"

set "MAPCREATOR_OPEN_PATH=/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1"
set "MAPCREATOR_DEV_CACHE_MODE=revalidate-static"
call run_server.bat %*
exit /b %ERRORLEVEL%

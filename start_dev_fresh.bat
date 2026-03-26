@echo off
setlocal
cd /d "%~dp0"

set "MAPCREATOR_OPEN_PATH=/?render_profile=balanced&startup_interaction=full&startup_worker=0&startup_cache=0"
set "MAPCREATOR_DEV_CACHE_MODE=nostore"
call run_server.bat %*
exit /b %ERRORLEVEL%

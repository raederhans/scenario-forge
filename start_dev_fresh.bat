@echo off
setlocal
cd /d "%~dp0"

set "MAPCREATOR_OPEN_PATH=/?render_profile=balanced&startup_interaction=full"
set "MAPCREATOR_DEV_CACHE_MODE=nostore"
call run_server.bat %*
exit /b %ERRORLEVEL%

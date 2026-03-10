@echo off
setlocal
cd /d "%~dp0"

set "MAPCREATOR_OPEN_PATH=/?render_profile=auto"
call run_server.bat %*
exit /b %ERRORLEVEL%

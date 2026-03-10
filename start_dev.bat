@echo off
setlocal
cd /d "%~dp0"

set "MAPCREATOR_SKIP_PAUSE=1"
call build_data.bat %*
if errorlevel 1 exit /b %ERRORLEVEL%

call run_server.bat
exit /b %ERRORLEVEL%

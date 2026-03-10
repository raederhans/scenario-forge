@echo off
setlocal
cd /d "%~dp0"

set "MAPCREATOR_RUNTIME_ROOT=%~dp0.runtime"
if not exist "%MAPCREATOR_RUNTIME_ROOT%\python\pycache" mkdir "%MAPCREATOR_RUNTIME_ROOT%\python\pycache"
set "PYTHONPYCACHEPREFIX=%MAPCREATOR_RUNTIME_ROOT%\python\pycache"

python tools\dev_server.py %*
exit /b %ERRORLEVEL%

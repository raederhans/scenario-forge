@echo off
setlocal
cd /d "%~dp0"

set "MAPCREATOR_RUNTIME_ROOT=%~dp0.runtime"
if not exist "%MAPCREATOR_RUNTIME_ROOT%\python\pycache" mkdir "%MAPCREATOR_RUNTIME_ROOT%\python\pycache"
set "PYTHONPYCACHEPREFIX=%MAPCREATOR_RUNTIME_ROOT%\python\pycache"

python init_map_data.py %*
set "EXIT_CODE=%ERRORLEVEL%"
if not defined MAPCREATOR_SKIP_PAUSE pause
exit /b %EXIT_CODE%

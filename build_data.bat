@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "MAPCREATOR_RUNTIME_ROOT=%~dp0.runtime"
if not exist "%MAPCREATOR_RUNTIME_ROOT%\python\pycache" mkdir "%MAPCREATOR_RUNTIME_ROOT%\python\pycache"
set "PYTHONPYCACHEPREFIX=%MAPCREATOR_RUNTIME_ROOT%\python\pycache"

call :resolve_python_launcher
if errorlevel 1 exit /b %ERRORLEVEL%

%MAPCREATOR_PYTHON_EXE% %MAPCREATOR_PYTHON_ARGS% init_map_data.py %*
set "EXIT_CODE=%ERRORLEVEL%"
if not defined MAPCREATOR_SKIP_PAUSE pause
exit /b %EXIT_CODE%

:resolve_python_launcher
py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 (
  set "MAPCREATOR_PYTHON_EXE=py"
  set "MAPCREATOR_PYTHON_ARGS=-3"
  exit /b 0
)
python -c "import sys" >nul 2>nul
if not errorlevel 1 (
  set "MAPCREATOR_PYTHON_EXE=python"
  set "MAPCREATOR_PYTHON_ARGS="
  exit /b 0
)
echo [ERROR] Python launcher not found. Install Python or enable the py launcher.
exit /b 1

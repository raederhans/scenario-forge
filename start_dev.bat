@echo off
setlocal
cd /d "%~dp0"

set "START_MODE=%~1"
if /I "%START_MODE%"=="fast" (
  shift
  goto :fast
)
if /I "%START_MODE%"=="fresh" (
  shift
  goto :fresh
)
if /I "%START_MODE%"=="full" (
  shift
  goto :full
)

call run_server.bat %*
exit /b %ERRORLEVEL%

:fast
set "MAPCREATOR_OPEN_PATH=/app/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1"
set "MAPCREATOR_DEV_CACHE_MODE=revalidate-static"
call run_server.bat %*
exit /b %ERRORLEVEL%

:fresh
set "MAPCREATOR_OPEN_PATH=/app/?render_profile=balanced&startup_interaction=full&startup_worker=0&startup_cache=0"
set "MAPCREATOR_DEV_CACHE_MODE=nostore"
call run_server.bat %*
exit /b %ERRORLEVEL%

:full
set "MAPCREATOR_SKIP_PAUSE=1"
call build_data.bat %*
if errorlevel 1 exit /b %ERRORLEVEL%

call run_server.bat
exit /b %ERRORLEVEL%

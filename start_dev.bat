@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

set "START_MODE=%~1"
set "FORWARDED_ARGS="
if /I "%START_MODE%"=="fast" (
  goto :fast
)
if /I "%START_MODE%"=="fresh" (
  goto :fresh
)
if /I "%START_MODE%"=="full" (
  goto :full
)

call run_server.bat %*
exit /b %ERRORLEVEL%

:fast
shift
call :collect_forwarded_args %1 %2 %3 %4 %5 %6 %7 %8 %9
set "MAPCREATOR_OPEN_PATH=/app/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1"
set "MAPCREATOR_DEV_CACHE_MODE=revalidate-static"
call run_server.bat %FORWARDED_ARGS%
exit /b %ERRORLEVEL%

:fresh
shift
call :collect_forwarded_args %1 %2 %3 %4 %5 %6 %7 %8 %9
set "MAPCREATOR_OPEN_PATH=/app/?render_profile=balanced&startup_interaction=full&startup_worker=0&startup_cache=0"
set "MAPCREATOR_DEV_CACHE_MODE=nostore"
call run_server.bat %FORWARDED_ARGS%
exit /b %ERRORLEVEL%

:full
shift
call :collect_forwarded_args %1 %2 %3 %4 %5 %6 %7 %8 %9
set "MAPCREATOR_SKIP_PAUSE=1"
call build_data.bat
if errorlevel 1 exit /b %ERRORLEVEL%

call run_server.bat %FORWARDED_ARGS%
exit /b %ERRORLEVEL%

:collect_forwarded_args
if "%~1"=="" exit /b 0
set "FORWARDED_ARGS=%FORWARDED_ARGS% "%~1""
shift
goto :collect_forwarded_args

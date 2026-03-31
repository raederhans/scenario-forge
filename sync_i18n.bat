@echo off
setlocal

cd /d "%~dp0"

set "MACHINE_TRANSLATE=0"
set "EXTRA_TRANSLATE_ARGS="
if /I "%~1"=="--machine" set "MACHINE_TRANSLATE=1"
if "%MACHINE_TRANSLATE%"=="1" (
  shift
  set "EXTRA_TRANSLATE_ARGS=%*"
)

echo [i18n] Step 1/3: Generate GEO stable-key aliases...
python tools\geo_key_normalizer.py
if errorlevel 1 goto :error

echo [i18n] Step 2/3: Sync translations...
set "I18N_BASELINE=data\i18n\locales_baseline.json"
set "I18N_AUDIT=.runtime\reports\generated\translation_source_audit.json"
set "I18N_REVIEW=.runtime\reports\generated\translation_review_queue.json"
if "%MACHINE_TRANSLATE%"=="1" (
  echo [i18n] Machine translation fallback enabled.
  python tools\translate_manager.py --baseline-locales "%I18N_BASELINE%" --audit-report "%I18N_AUDIT%" --review-queue "%I18N_REVIEW%" --machine-translate --translator-delay-seconds 0.05 %EXTRA_TRANSLATE_ARGS%
) else (
  python tools\translate_manager.py --baseline-locales "%I18N_BASELINE%" --audit-report "%I18N_AUDIT%" --review-queue "%I18N_REVIEW%"
)
if errorlevel 1 goto :error

echo [i18n] Step 3/3: Run translation coverage audit...
python tools\i18n_audit.py
if errorlevel 1 goto :error

echo.
echo [i18n] Done.
echo [i18n] Outputs:
echo   - data\geo_aliases.json
echo   - data\locales.json
echo   - .runtime\reports\generated\translation\translation_coverage_report.md
echo   - .runtime\reports\generated\translation\translation_coverage_report.json
echo.
pause
exit /b 0

:error
echo.
echo [i18n] Failed. Check errors above.
echo.
pause
exit /b 1

@echo off
setlocal

cd /d "%~dp0"
echo [i18n] sync_i18n_machine.bat is a compatibility wrapper. Use sync_i18n.bat --machine for the main entrypoint.
call sync_i18n.bat --machine --network-mode auto --auto-country-codes visible-missing --max-machine-translations 2500 --translator-delay-seconds 0.05

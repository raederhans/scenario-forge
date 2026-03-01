@echo off
setlocal

cd /d "%~dp0"
call sync_i18n.bat --machine --network-mode auto --auto-country-codes visible-missing --max-machine-translations 2500 --translator-delay-seconds 0.05

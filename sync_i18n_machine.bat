@echo off
setlocal

cd /d "%~dp0"
call sync_i18n.bat --machine

@echo off
set "SCRIPT=%~dp0scripts\uninstall.ps1"
cd /d "%TEMP%"
powershell.exe -ExecutionPolicy Bypass -File "%SCRIPT%"
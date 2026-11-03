@echo off
title Schematic Reader - LIVE for everyone
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0public.ps1" %*
echo.
pause

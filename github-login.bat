@echo off
title GitHub sign-in for AI Circuit Schematic Reader
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" -Login
echo.
pause

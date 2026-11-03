@echo off
title Schematic Reader - analysis server
cd /d "%~dp0"
set "SITE=http://127.0.0.1:8000/"

where python >nul 2>nul || (echo Python 3.11 or newer is required: https://www.python.org/downloads/ & pause & exit /b 1)
python -c "import fastapi, uvicorn, multipart, ollama, PIL, pydantic" 2>nul || (
  echo Installing the Python packages, first run only...
  python -m pip install -r "server\requirements.txt" || (pause & exit /b 1)
)
where ollama >nul 2>nul || echo WARNING: Ollama was not found. Install it from https://ollama.com, then run: ollama pull qwen3-vl:8b-instruct

echo.
echo Starting the analysis server on http://127.0.0.1:8000
echo The live app opens in your browser. Keep this window open while you use it.
echo To make the public website Live for everyone, run Start-Public.bat instead.
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 4; Start-Process '%SITE%'"
python "server\app.py"
pause

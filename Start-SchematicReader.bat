@echo off
title Schematic Reader - analysis server
cd /d "%~dp0"
set "SITE=https://aditya2885.github.io/ai-circuit-schematic-reader/"

where python >nul 2>nul || (echo Python 3.11 or newer is required: https://www.python.org/downloads/ & pause & exit /b 1)
python -c "import fastapi, uvicorn, multipart, ollama, PIL, pydantic" 2>nul || (
  echo Installing the Python packages, first run only...
  python -m pip install -r "server\requirements.txt" || (pause & exit /b 1)
)
where ollama >nul 2>nul || echo WARNING: Ollama was not found. Install it from https://ollama.com, then run: ollama pull qwen3-vl:8b-instruct

echo.
echo Starting the analysis server on http://127.0.0.1:8000
echo The website opens in your browser. If the browser asks to let the site access apps on this device
echo or your local network, click Allow. Keep this window open while you use the website.
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 4; Start-Process '%SITE%'"
python "server\app.py"
pause

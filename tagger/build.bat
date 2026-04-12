@echo off
REM Build a standalone map-tagger.exe via PyInstaller.
REM Run from the tagger/ directory: .\build.bat

setlocal
cd /d "%~dp0"

if not exist .venv (
    echo Creating Python virtual environment...
    python -m venv .venv
)

echo Installing dependencies...
.venv\Scripts\pip install -q -e . pyinstaller

echo Building standalone exe...
.venv\Scripts\pyinstaller --onefile --name map-tagger --paths src entry.py --distpath dist -y

echo.
echo Done: dist\map-tagger.exe

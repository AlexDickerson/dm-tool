@echo off
REM Build a standalone map-tagger.exe via Nuitka.
REM Run from the tagger/ directory: .\build.bat

setlocal
cd /d "%~dp0"

if not exist .venv (
    echo Creating Python virtual environment...
    python -m venv .venv
)

echo Installing dependencies...
.venv\Scripts\pip install -q -e . "nuitka[onefile]"

echo Building standalone exe with Nuitka (first build takes a few minutes)...
.venv\Scripts\python -m nuitka ^
  --onefile ^
  --assume-yes-for-downloads ^
  --output-filename=map-tagger.exe ^
  --output-dir=dist ^
  --include-package=dnd_map_tagger ^
  --windows-console-mode=force ^
  --remove-output ^
  entry.py

echo.
echo Done: dist\map-tagger.exe

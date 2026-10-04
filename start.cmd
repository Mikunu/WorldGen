@echo off
cd /d "%~dp0"
if exist "release\WorldGen_0.1.0-alpha.1.exe" (
  start "" "release\WorldGen_0.1.0-alpha.1.exe"
  exit /b 0
)
if exist "release\WorldGen.exe" (
  start "" "release\WorldGen.exe"
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required for development. See README.md.
  pause
  exit /b 1
)
node scripts\task.mjs dev
if errorlevel 1 pause

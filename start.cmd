@echo off
cd /d "%~dp0"
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

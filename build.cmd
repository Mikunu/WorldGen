@echo off
cd /d "%~dp0"
node scripts\task.mjs build
if errorlevel 1 pause

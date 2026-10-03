@echo off
cd /d "%~dp0"
node scripts\task.mjs dev
if errorlevel 1 pause

@echo off
cd /d "%~dp0"
where npm.cmd >nul 2>nul
if not errorlevel 1 (
  goto install_npm
)
where pnpm.cmd >nul 2>nul
if not errorlevel 1 (
  goto install_pnpm
)
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" (
  goto install_bundled_pnpm
)
echo Install Node.js 22 or newer including npm: https://nodejs.org/
pause
exit /b 1
:install_npm
call npm.cmd install
exit /b %errorlevel%
:install_pnpm
call pnpm.cmd install --frozen-lockfile
exit /b %errorlevel%
:install_bundled_pnpm
call "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" install --frozen-lockfile
exit /b %errorlevel%

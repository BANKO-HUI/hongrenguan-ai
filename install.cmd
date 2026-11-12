@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Bomi Zhihui requires Node.js 20.9 or newer.
  echo Install Node.js from https://nodejs.org/ and run this installer again.
  pause
  exit /b 1
)
node master-kit\scripts\bootstrap.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
node scripts\launch.js
echo.
echo Bomi Zhihui is installed and open.
pause

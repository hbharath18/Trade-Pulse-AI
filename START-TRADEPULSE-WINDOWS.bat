@echo off
setlocal
cd /d "%~dp0"
title TradePulse AI Setup
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Install Node.js 22.13+ or Node 24 LTS from https://nodejs.org/
  pause
  exit /b 1
)
for /f "delims=" %%V in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 22 (
  echo ERROR: Node.js version 22.13+ is required. You have:
  node --version
  pause
  exit /b 1
)
if not exist "server\.env" (
  copy "server\.env.example" "server\.env" >nul
  echo Created server\.env. Add Gmail credentials later when ready for outreach.
)
if not exist "node_modules\vite" (
  echo [1/2] Installing dashboard dependencies from lockfile...
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto install_error
)
if not exist "server\node_modules\express" (
  echo [2/2] Installing backend dependencies from lockfile...
  call npm --prefix server ci --no-audit --no-fund
  if errorlevel 1 goto install_error
)
echo.
echo Opening local API and dashboard in separate terminals...
start "TradePulse API" /D "%~dp0" cmd /k "npm run dev:api"
start "TradePulse Dashboard" /D "%~dp0" cmd /k "npm run dev"
echo.
echo TradePulse uses http://localhost:3000 and API port 4100.
echo If Vite selects a different port, follow the URL shown in its terminal.
echo Close both terminals when finished. No emails send automatically.
pause
exit /b 0
:install_error
echo.
echo ERROR: Dependency installation failed.
echo Check your internet connection, Node.js version and npm errors, then run this script again.
pause
exit /b 1

@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
title Resume Workshop - Local Development

echo.
echo ================================================
echo   Resume Workshop - Local one-click startup
echo ================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22.12 or newer from https://nodejs.org/
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js and make sure npm is on PATH.
  pause
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number); if(v[0]<22 || (v[0]===22 && v[1]<12)) process.exit(1)"
if errorlevel 1 (
  echo [ERROR] Node.js 22.12 or newer is required.
  node --version
  pause
  exit /b 1
)

if not exist ".env" (
  echo [1/6] Creating .env from .env.example...
  copy /Y ".env.example" ".env" >nul
  if errorlevel 1 goto :failed
)

echo [2/6] Checking local encryption key...
node -e "const fs=require('fs'),crypto=require('crypto'),p='.env';let s=fs.readFileSync(p,'utf8'),line='USER_SECRET_ENCRYPTION_KEY='+crypto.randomBytes(32).toString('hex'),re=/^USER_SECRET_ENCRYPTION_KEY=.*$/m;if(!/^USER_SECRET_ENCRYPTION_KEY=[0-9a-f]{64}$/mi.test(s)){s=re.test(s)?s.replace(re,line):s+'\n'+line+'\n';fs.writeFileSync(p,s)}"
if errorlevel 1 goto :failed

if not exist "node_modules" (
  echo [3/6] Installing npm dependencies...
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto :failed
) else (
  echo [3/6] npm dependencies already installed.
)

if not exist "node_modules\.prisma\client" (
  echo [4/6] Generating Prisma client...
  call npm run db:generate
  if errorlevel 1 goto :failed
) else (
  echo [4/6] Prisma client already generated.
)

echo [5/6] Applying SQLite migrations and seeding local templates...
call npm run db:migrate
if errorlevel 1 goto :failed
call npm run db:seed
if errorlevel 1 goto :failed

echo [6/6] Ensuring Chromium is available for PDF export...
call npx playwright install chromium
if errorlevel 1 goto :failed

echo.
echo Starting the web app at http://127.0.0.1:3000
echo Keep this window open while using the app. Press Ctrl+C to stop it.
echo.
call npm run dev
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo [ERROR] Startup failed. Read the message above, fix the issue, and run start.bat again.
pause
exit /b 1

@echo off
REM تشغيل ERP TOURECHE على Windows (أول مرة: يثبّت ويبني تلقائياً)
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22+ from https://nodejs.org & pause & exit /b 1)
if not exist node_modules call npm run setup
if not exist client\dist call npm run setup
npm start
pause

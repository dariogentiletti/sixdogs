@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo. & echo  Node.js is not installed. Get the LTS version from https://nodejs.org and run this again. & echo. & pause & exit /b 1)
node run.mjs
pause

@echo off
setlocal
REM Lancement en développement (après un build frontend mode desktop) :
REM   cd desktop && scripts\run-dev.bat   (ou)   npm start
cd /d "%~dp0.."
npx electron .

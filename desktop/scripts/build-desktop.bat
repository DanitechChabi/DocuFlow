@echo off
setlocal
REM ============================================================
REM Build complet de l'application de bureau DocuFlow (Windows)
REM   1. Build du frontend (mode desktop, VITE_API_URL=/api)
REM   2. Icône applicative (build/icon.png)
REM   3. Installeur NSIS + portable (electron-builder --win)
REM Sortie : desktop\release\DocuFlow-Setup-<version>.exe
REM          desktop\release\DocuFlow-Portable-<version>.exe
REM ============================================================

echo [1/3] Build frontend (mode desktop)...
cd /d "%~dp0..\..\frontend"
call npm run build -- --mode desktop
if errorlevel 1 goto :error

echo [2/3] Génération de l'icône...
cd /d "%~dp0.."
node scripts\make-icon.js

echo [3/3] electron-builder --win...
call npx electron-builder --win
if errorlevel 1 goto :error

echo.
echo [OK] Terminé. Artefacts dans desktop\release\
goto :eof

:error
echo.
echo [ERREUR] Build échoué.
exit /b 1

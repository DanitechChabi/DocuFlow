@echo off
setlocal
REM ============================================================
REM Build complet de l'application de bureau DocuFlow (Windows)
REM   1. Déclinaisons de la marque (frontend\public\brand + build\icon.*)
REM   2. Build du frontend (mode desktop, VITE_API_URL=/api)
REM   3. Installeur NSIS + portable (electron-builder --win)
REM Sortie : desktop\release\DocuFlow-Setup-<version>.exe
REM          desktop\release\DocuFlow-Portable-<version>.exe
REM
REM L'étape 1 précède le build du frontend : Vite recopie public\ au moment du
REM build, donc des déclinaisons régénérées après coup n'atteindraient dist\
REM qu'au build suivant.
REM ============================================================

echo [1/3] Génération des déclinaisons de la marque...
cd /d "%~dp0.."
node scripts\make-brand.js

echo [2/3] Build frontend (mode desktop)...
cd /d "%~dp0..\..\frontend"
call npm run build -- --mode desktop
if errorlevel 1 goto :error

echo [3/3] electron-builder --win...
cd /d "%~dp0.."
call npx electron-builder --win
if errorlevel 1 goto :error

echo.
echo [OK] Terminé. Artefacts dans desktop\release\
goto :eof

:error
echo.
echo [ERREUR] Build échoué.
exit /b 1

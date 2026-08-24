@echo off
setlocal
REM ============================================================
REM Build complet de l'application de bureau DocuFlow (Windows)
REM   0. Binaires PostgreSQL portables (vendor\pgsql) — ~330 Mo au 1er passage
REM   1. Déclinaisons de la marque (frontend\public\brand + build\icon.* +
REM      artwork de l'assistant NSIS)
REM   2. Build du frontend (mode desktop, VITE_API_URL=/api)
REM   3. Installeur NSIS (electron-builder --win)
REM Sortie : desktop\release\DocuFlow-Setup-<version>.exe
REM
REM Cible unique : la version « portable » a été retirée. Elle n'avait pas de
REM sens pour un logiciel qui installe sa propre base de données, et les deux
REM artefacts divergeaient silencieusement.
REM
REM L'étape 0 précède tout : package.json déclare vendor\pgsql en
REM extraResources, donc electron-builder échoue si le dossier est absent. Le
REM script est idempotent — au deuxième build il ne retélécharge rien.
REM
REM L'étape 1 précède le build du frontend : Vite recopie public\ au moment du
REM build, donc des déclinaisons régénérées après coup n'atteindraient dist\
REM qu'au build suivant. Elle produit aussi l'artwork de l'assistant NSIS, sans
REM lequel l'installateur afficherait le visuel générique de NSIS.
REM ============================================================

echo [0/3] Binaires PostgreSQL portables...
cd /d "%~dp0.."
node scripts\fetch-postgres.js
if errorlevel 1 goto :error

echo [1/3] Génération des déclinaisons de la marque...
cd /d "%~dp0.."
node scripts\make-brand.js
REM Contrôlé, contrairement aux versions antérieures : la marque n'est plus
REM seulement cosmétique, elle fournit build\icon.ico que win.icon exige et
REM l'artwork que NSIS refuse de remplacer silencieusement.
if errorlevel 1 goto :error

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

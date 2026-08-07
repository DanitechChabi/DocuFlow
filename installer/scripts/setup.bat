@echo off
setlocal
REM ============================================================
REM DocuFlow — Script d'installation (appelé par l'installateur)
REM Usage : setup.bat "C:\Program Files\DocuFlow" host port user password dbname
REM ============================================================
set "APP_DIR=%~1"
set "DB_HOST=%~2"
set "DB_PORT=%~3"
set "DB_USER=%~4"
set "DB_PASS=%~5"
set "DB_NAME=%~6"

echo.
echo ========================================
echo   DocuFlow — Installation en cours...
echo ========================================
echo.

REM --- Node.js ---
set "NODE=%APP_DIR%\node\node.exe"
set "NPM=%APP_DIR%\node\npm.cmd"
if not exist "%NODE%" (
  echo [ERREUR] Node.js non trouvé dans %APP_DIR%\node\
  echo Installez Node.js depuis https://nodejs.org et copiez-le dans %APP_DIR%\node\
  exit /b 1
)
echo [OK] Node.js : %NODE%

REM --- npm install ---
echo.
echo [1/3] Installation des dépendances npm...
cd /d "%APP_DIR%\backend"
"%NPM%" install --omit=dev --no-audit --no-fund 2>&1
if errorlevel 1 (
  echo [ERREUR] npm install échoué.
  exit /b 1
)
echo [OK] Dépendances installées.

REM --- Fichier .env ---
echo.
echo [2/3] Configuration...
(
  echo PORT=31000
  echo DB_HOST=%DB_HOST%
  echo DB_PORT=%DB_PORT%
  echo DB_USER=%DB_USER%
  echo DB_PASSWORD=%DB_PASS%
  echo DB_NAME=%DB_NAME%
  echo JWT_SECRET=DOCUFLOW_PROD_SECRET_%RANDOM%%RANDOM%
  echo SERVE_FRONTEND=true
  echo HOST=0.0.0.0
) > "%APP_DIR%\backend\.env"
echo [OK] Fichier .env créé.

REM --- Migrations + seed ---
echo.
echo [3/3] Migration de la base de données...
cd /d "%APP_DIR%"
"%NODE%" "%APP_DIR%\scripts\run-migrations.js"
if errorlevel 1 (
  echo [ERREUR] Migration échouée. Vérifiez que PostgreSQL est démarré.
  exit /b 1
)
echo [OK] Base de données prête.

echo.
echo ========================================
echo   Installation terminée !
echo ========================================
echo.

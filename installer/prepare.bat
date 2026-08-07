@echo off
setlocal
REM ============================================================
REM DocuFlow — Prépare le runtime Node.js portable (installer\node\)
REM À lancer une seule fois, avant de compiler l'installateur.
REM ============================================================
set "NODE_VERSION=v24.14.1"
set "ZIP=%TEMP%\node-%NODE_VERSION%-win-x64.zip"
set "EXTRACT=%TEMP%\node-extract"
set "DEST=%~dp0node"

if exist "%DEST%\node.exe" (
  echo [OK] Node.js portable déjà présent dans installer\node\
  goto :done
)

echo [1/3] Téléchargement de Node.js %NODE_VERSION% (portable x64)...
curl -L --fail -o "%ZIP%" "https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip"
if errorlevel 1 (
  echo [ERREUR] Téléchargement échoué. Vérifiez votre connexion.
  exit /b 1
)

echo [2/3] Extraction...
if exist "%EXTRACT%" rmdir /s /q "%EXTRACT%"
mkdir "%EXTRACT%"
powershell -NoProfile -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '%EXTRACT%' -Force"
if errorlevel 1 (
  echo [ERREUR] Extraction échouée.
  exit /b 1
)

echo [3/3] Copie vers installer\node\...
mkdir "%DEST%" 2>nul
xcopy /s /e /y /q "%EXTRACT%\node-%NODE_VERSION%-win-x64\*" "%DEST%\" >nul
if errorlevel 1 (
  echo [ERREUR] Copie échouée.
  exit /b 1
)

del /q "%ZIP%" 2>nul
rmdir /s /q "%EXTRACT%" 2>nul
echo [OK] Node.js portable prêt : installer\node\ (%DEST%)
:done
endlocal

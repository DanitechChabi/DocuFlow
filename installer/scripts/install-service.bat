@echo off
setlocal
REM ============================================================
REM DocuFlow — Installation du service Windows (tâche planifiée
REM démarrant au boot, exécutée en tant que SYSTEM)
REM Usage : install-service.bat "C:\Program Files\DocuFlow"
REM ============================================================
set "APP_DIR=%~1"
set "CMD=cmd /c cd /d "%APP_DIR%\backend" ^&^& "%APP_DIR%\node\node.exe" src\app.js"

echo Création du service Windows DocuFlow...

REM Supprime une éventuelle tâche existante
schtasks /delete /tn "DocuFlow" /f >nul 2>&1

REM Crée la tâche : démarre au boot en tant que SYSTEM
schtasks /create /tn "DocuFlow" /tr "%CMD%" /sc onstart /ru SYSTEM /rl highest /f
if errorlevel 1 (
  echo [ERREUR] Impossible de créer la tâche planifiée.
  echo Exécutez l'installation en tant qu'administrateur.
  exit /b 1
)

REM Démarre immédiatement
schtasks /run /tn "DocuFlow" >nul 2>&1

echo [OK] Service DocuFlow installé et démarré.
echo      Il démarrera automatiquement au prochain démarrage du serveur.
endlocal

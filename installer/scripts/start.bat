@echo off
REM DocuFlow — Lancer l'application (serveur + navigateur)
set "APP_DIR=%~dp0.."
set "URL=http://127.0.0.1:31000"

REM Si le serveur tourne déjà (service Windows), on ouvre juste le navigateur
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient; try{$c.Connect('127.0.0.1',31000); exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto :open

REM Sinon, démarrer le serveur puis ouvrir le navigateur
start "" /min cmd /c "cd /d "%APP_DIR%\backend" && "%APP_DIR%\node\node.exe" src\app.js"
timeout /t 3 /nobreak >nul

:open
start "" "%URL%"

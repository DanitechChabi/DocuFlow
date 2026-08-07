@echo off
REM DocuFlow — Arrêter le service
echo Arrêt de DocuFlow...
taskkill /f /im node.exe /fi "WINDOWTITLE eq DocuFlow*" >nul 2>&1
schtasks /end /tn "DocuFlow" >nul 2>&1
echo DocuFlow arrêté.

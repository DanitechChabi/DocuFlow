@echo off
REM DocuFlow — Suppression du service Windows
echo Suppression du service DocuFlow...
schtasks /end /tn "DocuFlow" >nul 2>&1
schtasks /delete /tn "DocuFlow" /f >nul 2>&1
echo [OK] Service DocuFlow supprimé.

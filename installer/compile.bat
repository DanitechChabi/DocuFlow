@echo off
REM Compile l'installateur DocuFlow avec Inno Setup
set "ISCC=C:\Users\ADMIN\AppData\Local\Programs\Inno Setup 6\ISCC.exe"
set "ISS=%~dp0docuflow-setup.iss"

if not exist "%ISCC%" (
  echo [ERREUR] Inno Setup non trouvé : %ISCC%
  echo Installez-le depuis https://jrsoftware.org/isinfo.php
  exit /b 1
)

echo Compilation de l'installateur DocuFlow...
"%ISCC%" "%ISS%"
if errorlevel 1 (
  echo [ERREUR] Compilation échouée.
  exit /b 1
)

echo.
echo [OK] Installateur généré : docuflow\release\DocuFlow-Setup-1.0.0.exe

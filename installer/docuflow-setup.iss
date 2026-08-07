; ============================================================================
; DocuFlow — Installeur Windows avec interface graphique (wizard)
; À compiler :  ISCC.exe docuflow-setup.iss
; Prérequis :   installer\node\ (Node.js portable) + desktop\build\icon.ico
; ============================================================================
#define MyAppName "DocuFlow"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "CHABI BOUKO Daniel"
#define MyAppURL "https://docuflow.vercel.app"
#define NodeDir "node"

[Setup]
AppId={{8E3B9E2C-5C4D-4F2A-9B7C-1D5E6F8A0B3C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=release
OutputBaseFilename=DocuFlow-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
SetupIconFile=..\desktop\build\icon.ico
UninstallDisplayIcon={app}\icon.ico
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
PrivilegesRequired=admin

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startservice"; Description: "Démarrer DocuFlow au démarrage du serveur (service Windows)"; GroupDescription: "Service:"; Flags: unchecked

[Files]
; Node.js portable (runtime)
Source: "{#NodeDir}\*"; DestDir: "{app}\node"; Flags: recursesubdirs createallsubdirs ignoreversion
; Backend (source + npm install à l'installation)
Source: "..\backend\src\*"; DestDir: "{app}\backend\src"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "..\backend\package.json"; DestDir: "{app}\backend"; Flags: ignoreversion
; Frontend compilé (servi par le backend, même-origine)
Source: "..\frontend\dist\*"; DestDir: "{app}\frontend\dist"; Flags: recursesubdirs createallsubdirs ignoreversion
; Schéma + migrations SQL
Source: "..\docs\setup_db.sql"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "..\docs\migrations\*.sql"; DestDir: "{app}\docs\migrations"; Flags: ignoreversion
; Scripts de service et d'installation
Source: "scripts\*"; DestDir: "{app}\scripts"; Flags: recursesubdirs ignoreversion
; Icône
Source: "..\desktop\build\icon.ico"; DestDir: "{app}"; DestName: "icon.ico"; Flags: ignoreversion
Source: "..\desktop\build\icon.png"; DestDir: "{app}"; DestName: "icon.png"; Flags: ignoreversion

[Dirs]
Name: "{app}\backend\uploads"; Permissions: users-modify
Name: "{app}\backend\uploads\files"; Permissions: users-modify

[Icons]
Name: "{group}\DocuFlow"; Filename: "{app}\scripts\start.bat"; IconFilename: "{app}\icon.ico"; WorkingDir: "{app}"
Name: "{group}\DocuFlow — Arrêter"; Filename: "{app}\scripts\stop.bat"; IconFilename: "{app}\icon.ico"; WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\DocuFlow"; Filename: "{app}\scripts\start.bat"; IconFilename: "{app}\icon.ico"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; 1) npm install + .env + migrations
Filename: "{app}\scripts\setup.bat"; Parameters: "{code:SetupParams}"; StatusMsg: "Installation des dépendances et configuration de la base..."; Flags: waituntilterminated
; 2) Service (optionnel)
Filename: "{app}\scripts\install-service.bat"; Parameters: """{app}"""; StatusMsg: "Installation du service Windows..."; Tasks: startservice; Flags: waituntilterminated runhidden
; 3) Lancer l'application
Filename: "{app}\scripts\start.bat"; Description: "Lancer DocuFlow maintenant"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\scripts\uninstall-service.bat"; Flags: runhidden

[Code]
var
  DBPage: TInputQueryWizardPage;

// --- Page de configuration de la base ---
procedure InitializeWizard;
begin
  DBPage := CreateInputQueryPage(
    wpSelectTasks,
    'Configuration de la base de données',
    'DocuFlow utilise PostgreSQL pour stocker les données.',
    'Renseignez les paramètres de connexion à votre serveur PostgreSQL. ' +
    'Ces valeurs seront enregistrées dans le fichier .env de l''application.');

  DBPage.Add('Hôte PostgreSQL :', False);
  DBPage.Add('Port :', False);
  DBPage.Add('Utilisateur :', False);
  DBPage.Add('Mot de passe :', True);  { Password = True }
  DBPage.Add('Nom de la base :', False);

  DBPage.Values[0] := 'localhost';
  DBPage.Values[1] := '5432';
  DBPage.Values[2] := 'postgres';
  DBPage.Values[3] := '';
  DBPage.Values[4] := 'docuflow';
end;

// Échappe une valeur pour l'insérer dans une ligne de commande
function Q(const S: String): String;
var
  T: String;
begin
  T := S;
  StringChangeEx(T, '"', '\"', False);
  Result := '"' + T + '"';
end;

// Paramètres passés à setup.bat : app_dir host port user pass dbname
function SetupParams(Param: String): String;
begin
  Result := Q(ExpandConstant('{app}')) + ' ' +
            Q(Trim(DBPage.Values[0])) + ' ' +
            Q(Trim(DBPage.Values[1])) + ' ' +
            Q(Trim(DBPage.Values[2])) + ' ' +
            Q(DBPage.Values[3]) + ' ' +
            Q(Trim(DBPage.Values[4]));
end;

// Validation de la page base avant de continuer
function ValidateDBPage: Boolean;
begin
  Result := False;
  if Trim(DBPage.Values[0]) = '' then
  begin
    MsgBox('L''hôte PostgreSQL est requis.', mbError, MB_OK);
    Exit;
  end;
  if StrToIntDef(Trim(DBPage.Values[1]), 0) = 0 then
  begin
    MsgBox('Le port doit être un nombre (ex. 5432).', mbError, MB_OK);
    Exit;
  end;
  if Trim(DBPage.Values[2]) = '' then
  begin
    MsgBox('L''utilisateur PostgreSQL est requis.', mbError, MB_OK);
    Exit;
  end;
  if Trim(DBPage.Values[4]) = '' then
  begin
    MsgBox('Le nom de la base est requis.', mbError, MB_OK);
    Exit;
  end;
  Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = DBPage.ID then
    Result := ValidateDBPage;
end;

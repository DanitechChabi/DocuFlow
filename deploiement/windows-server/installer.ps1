# ============================================================================
# installer.ps1 — installe DocuFlow AFGC sur un Windows Server du réseau
# interne. À lancer depuis le dossier « scripts » du paquet décompressé, dans
# PowerShell ouvert « en tant qu'administrateur ». Voir LISEZ-MOI.md.
#
# Exemple :
#   .\installer.ps1 -NomServeur archives.afgcsa.com -Certificat D:\certs\archives.pfx
#
# Ce que fait le script (relançable : il ne détruit rien de ce qui existe) :
#   1. vérifie Node.js et PostgreSQL ;
#   2. copie l'application dans C:\DocuFlow\app ;
#   3. crée la base « docuflow » et son compte (mot de passe aléatoire) ;
#   4. écrit la configuration C:\DocuFlow\config\docuflow.env (secrets générés
#      sur place, lisibles des seuls administrateurs) ;
#   5. crée la tâche « DocuFlow AFGC » (démarre avec Windows, relance en cas
#      d'arrêt) et la tâche de sauvegarde de chaque nuit ;
#   6. ouvre le pare-feu (profils Domaine et Privé : réseau interne) ;
#   7. démarre, vérifie, et crée l'espace AFGC et son administrateur si la base
#      est neuve (sauf -SansEspace, quand une base existante va être transférée).
# ============================================================================
param(
  [Parameter(Mandatory = $true)][string]$NomServeur,
  [string]$Certificat,
  [System.Security.SecureString]$MotDePasseCertificat,
  [string]$Dossier = 'C:\DocuFlow',
  [int]$Port = 0,
  [string]$PostgresBin,
  [string]$DossierSauvegardes,
  [string]$HeureSauvegarde = '02:00',
  [switch]$SansEspace
)
. (Join-Path $PSScriptRoot 'commun.ps1')
Verifier-Administrateur

$paquet = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $paquet 'app\backend\src\app.js'))) { Echec "lancez ce script depuis le dossier « scripts » du paquet DocuFlow (app\backend introuvable)." }
$https = [bool]$Certificat
if (-not $Port) { $Port = $(if ($https) { 443 } else { 80 }) }
if (-not $https) { Ecrire 'Attention : sans certificat (-Certificat), le site sera en HTTP simple, non chiffré sur le réseau.' 'Yellow' }

Etape 'Vérification de Node.js et de PostgreSQL'
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { Echec 'Node.js introuvable. Installez Node.js 22 LTS (voir le guide), puis rouvrez PowerShell.' }
$versionNode = (& node.exe -v).TrimStart('v')
if ([int]($versionNode.Split('.')[0]) -lt 20) { Echec "Node.js $versionNode est trop ancien : 20 ou plus requis (22 LTS conseillé)." }
$bin = Trouver-PostgresBin $PostgresBin
Ecrire "Node.js $versionNode · PostgreSQL : $bin" 'Green'

$conf = Join-Path $Dossier 'config'
$fichierConf = Join-Path $conf 'docuflow.env'
New-Item -ItemType Directory -Force -Path $conf, (Join-Path $Dossier 'donnees\fichiers'), (Join-Path $Dossier 'journaux') | Out-Null
if (-not $DossierSauvegardes) { $DossierSauvegardes = Join-Path $Dossier 'sauvegardes' }
New-Item -ItemType Directory -Force -Path $DossierSauvegardes | Out-Null

Etape "Copie de l'application dans $Dossier"
Arreter-Application
& robocopy (Join-Path $paquet 'app') (Join-Path $Dossier 'app') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Echec "copie de l'application impossible (robocopy $LASTEXITCODE)." }
& robocopy $PSScriptRoot (Join-Path $Dossier 'scripts') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Echec "copie des scripts impossible (robocopy $LASTEXITCODE)." }
Ecrire 'Application copiée.' 'Green'

$premiere = -not (Test-Path $fichierConf)
if ($premiere) {
  Etape 'Création de la base de données'
  $mdpPostgres = Read-Host 'Mot de passe du compte « postgres » (choisi à l''installation de PostgreSQL)' -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($mdpPostgres))
  $psql = Join-Path $bin 'psql.exe'
  $mdpBase = Nouveau-Secret 24
  $existe = & $psql -h localhost -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'docuflow'"
  if ($LASTEXITCODE -ne 0) { Echec 'connexion à PostgreSQL refusée : vérifiez le mot de passe du compte postgres.' }
  if ($existe -eq '1') { & $psql -h localhost -U postgres -qc "ALTER ROLE docuflow WITH LOGIN PASSWORD '$mdpBase'" }
  else { & $psql -h localhost -U postgres -qc "CREATE ROLE docuflow WITH LOGIN PASSWORD '$mdpBase'" }
  $base = & $psql -h localhost -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'docuflow'"
  if ($base -ne '1') { & $psql -h localhost -U postgres -qc "CREATE DATABASE docuflow OWNER docuflow ENCODING 'UTF8' TEMPLATE template0" }
  & $psql -h localhost -U postgres -d docuflow -qc 'CREATE EXTENSION IF NOT EXISTS pg_trgm'
  if ($LASTEXITCODE -ne 0) { Echec 'création de la base impossible.' }
  Remove-Item Env:\PGPASSWORD
  Ecrire 'Base « docuflow » prête.' 'Green'

  Etape 'Écriture de la configuration'
  $mdpPfx = ''
  if ($https) {
    if (-not (Test-Path $Certificat)) { Echec "certificat introuvable : $Certificat" }
    Copy-Item $Certificat (Join-Path $conf 'certificat.pfx') -Force
    if (-not $MotDePasseCertificat) { $MotDePasseCertificat = Read-Host 'Mot de passe du certificat .pfx (Entrée s''il n''en a pas)' -AsSecureString }
    $mdpPfx = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($MotDePasseCertificat))
  }
  $adresse = $(if ($https) { "https://$NomServeur" } else { "http://$NomServeur" })
  if (($https -and $Port -ne 443) -or (-not $https -and $Port -ne 80)) { $adresse = "${adresse}:$Port" }
  $lignes = @(
    '# Configuration de DocuFlow AFGC — générée par installer.ps1.',
    '# Contient des secrets : lisible des seuls administrateurs. Ne pas copier ailleurs.',
    'NODE_ENV=production',
    'HOST=0.0.0.0',
    "PORT=$Port",
    "APP_URL=$adresse",
    "CORS_ORIGIN=$adresse",
    'DB_HOST=localhost',
    'DB_PORT=5432',
    'DB_NAME=docuflow',
    'DB_USER=docuflow',
    "DB_PASSWORD=$mdpBase",
    "JWT_SECRET=$(Nouveau-Secret 48)",
    "UPLOADS_DIR=$(Join-Path $Dossier 'donnees\fichiers')",
    "FRONTEND_DIST=$(Join-Path $Dossier 'app\frontend')",
    "POSTGRES_BIN=$bin",
    "SAUVEGARDE_DOSSIER=$DossierSauvegardes",
    'SAUVEGARDE_JOURS=30'
  )
  if ($https) {
    $lignes += "HTTPS_PFX_PATH=$(Join-Path $conf 'certificat.pfx')"
    $lignes += "HTTPS_PFX_PASSPHRASE=$mdpPfx"
    if ($Port -eq 443) { $lignes += 'HTTP_REDIRECT_PORT=80' }
  }
  [IO.File]::WriteAllLines($fichierConf, $lignes, (New-Object System.Text.UTF8Encoding($false)))
  # Droits : SYSTEM (le service) et les administrateurs seulement.
  & icacls $conf /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  Ecrire "Configuration écrite : $fichierConf" 'Green'
} else {
  Ecrire "Configuration existante gardée : $fichierConf" 'Yellow'
}
$c = Lire-Configuration $fichierConf

Etape 'Tâches planifiées (démarrage avec Windows, sauvegarde de nuit)'
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$reglages = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable
$action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Dossier 'scripts\lancer.ps1')`" -Dossier `"$Dossier`""
Register-ScheduledTask -TaskName $NomTache -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $principal -Settings $reglages -Description 'Serveur DocuFlow AFGC (archives). Relancé automatiquement.' -Force | Out-Null
$actionS = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Dossier 'scripts\sauvegarder.ps1')`" -Dossier `"$Dossier`""
$reglagesS = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 4) -StartWhenAvailable
Register-ScheduledTask -TaskName $NomTacheSauvegarde -Action $actionS -Trigger (New-ScheduledTaskTrigger -Daily -At $HeureSauvegarde) -Principal $principal -Settings $reglagesS -Description 'Sauvegarde de la base et des fichiers DocuFlow AFGC.' -Force | Out-Null
Ecrire "Tâches « $NomTache » et « $NomTacheSauvegarde » (chaque jour à $HeureSauvegarde) en place." 'Green'

Etape 'Pare-feu (réseau interne)'
$ports = @([int]$c['PORT'])
if ($c['HTTP_REDIRECT_PORT']) { $ports += [int]$c['HTTP_REDIRECT_PORT'] }
foreach ($p in $ports) {
  $nom = "DocuFlow AFGC (TCP $p)"
  if (-not (Get-NetFirewallRule -DisplayName $nom -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $nom -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow -Profile Domain, Private | Out-Null
  }
}
Ecrire "Ports ouverts sur le réseau interne : $($ports -join ', ')." 'Green'

Etape 'Démarrage'
Demarrer-Application
$sch = $(if ($c['HTTPS_PFX_PATH']) { 'https' } else { 'http' })
$sante = Attendre-Sante "${sch}://localhost:$($c['PORT'])/api/health" 180
if (-not $sante) { Echec "le serveur ne répond pas, ou la base est injoignable (service PostgreSQL ?). Consultez $Dossier\journaux\docuflow-$(Get-Date -Format 'yyyy-MM-dd').log" }
if ($sante.base -ne 'ok') { Echec "le serveur répond mais la base est injoignable : vérifiez PostgreSQL et la configuration." }
if ($sante.migration_en_echec) { Echec "une mise à jour de la base a échoué ($($sante.migration_en_echec)) : voir le journal." }
Ecrire "Serveur en marche · base à jour ($($sante.derniere_migration))." 'Green'

if ($premiere -and -not $SansEspace) {
  Etape "Espace AFGC et compte administrateur"
  Ecrire 'Ce compte administre l''application (comptes, configuration). Choisissez un mot de passe solide.'
  $env:ESPACE_CODE = 'afgc'
  $env:ADMIN_IDENTIFIANT = Read-Host 'Identifiant de l''administrateur (ex. admin.afgc)'
  $env:ADMIN_NOM = Read-Host 'Nom complet'
  $env:ADMIN_EMAIL = Read-Host 'Adresse professionnelle (…@afgcsa.com)'
  $mdp = Read-Host 'Mot de passe (8 caractères au moins)' -AsSecureString
  $env:ADMIN_MOT_DE_PASSE = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($mdp))
  foreach ($cle in $c.Keys) { [Environment]::SetEnvironmentVariable($cle, $c[$cle], 'Process') }
  Push-Location (Join-Path $Dossier 'app\backend')
  & node.exe 'scripts\creer-espace.js'
  $code = $LASTEXITCODE
  Pop-Location
  Remove-Item Env:\ADMIN_MOT_DE_PASSE -ErrorAction SilentlyContinue
  if ($code -ne 0) { Echec 'création de l''espace impossible (voir le message ci-dessus). Relancez : .\installer.ps1 -NomServeur … ' }
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host " DocuFlow AFGC est installé : $($c['APP_URL'])" -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Ecrire " Données          : $Dossier\donnees"
Ecrire " Journaux         : $Dossier\journaux"
Ecrire " Sauvegardes      : $($c['SAUVEGARDE_DOSSIER'])  (à copier hors du serveur)"
Ecrire " Prochaine étape  : enregistrer « $NomServeur » dans le DNS interne, puis ouvrir l'adresse depuis un poste."

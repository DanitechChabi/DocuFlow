# ============================================================================
# transferer.ps1 — reprend sur le serveur interne les données de la version en
# ligne (comptes, demandes, listes, dossiers entrés, armoires, réglages).
# À faire une fois, juste après installer.ps1 -SansEspace, avant que les agents
# n'utilisent le serveur interne.
#
# La chaîne de connexion de la base en ligne se lit dans le tableau de bord
# Render (service docuflow › Environment › DATABASE_URL), ou chez l'hébergeur
# de la base (Neon). Elle est demandée à l'écran et n'est enregistrée nulle part.
# ============================================================================
param([string]$Dossier = 'C:\DocuFlow')
. (Join-Path $PSScriptRoot 'commun.ps1')
Verifier-Administrateur
$c = Lire-Configuration (Join-Path $Dossier 'config\docuflow.env')
$bin = Trouver-PostgresBin $c['POSTGRES_BIN']

$saisie = Read-Host 'Chaîne de connexion de la base en ligne (postgres://…)' -AsSecureString
$source = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($saisie))
if ($source -notmatch '^postgres(ql)?://') { Echec 'chaîne attendue au format postgres://utilisateur:motdepasse@hôte/base' }
if ($source -notmatch 'sslmode=') { $source += $(if ($source.Contains('?')) { '&sslmode=require' } else { '?sslmode=require' }) }

Ecrire 'Les données actuelles du serveur interne vont être REMPLACÉES par celles de la version en ligne.' 'Yellow'
if ((Read-Host 'Tapez TRANSFERER pour confirmer') -ne 'TRANSFERER') { Echec 'abandon : rien n''a été modifié.' }

$dump = Join-Path $env:TEMP "docuflow-en-ligne-$(Get-Date -Format 'yyyyMMdd_HHmm').dump"
try {
  Etape 'Copie de la base en ligne'
  & (Join-Path $bin 'pg_dump.exe') --no-owner --no-privileges -F c -f $dump $source
  if ($LASTEXITCODE -ne 0) { Echec 'lecture de la base en ligne impossible : vérifiez la chaîne de connexion et l''accès Internet du serveur.' }
  Ecrire ("Base en ligne copiée ({0:N1} Mo)." -f ((Get-Item $dump).Length / 1MB)) 'Green'

  Etape 'Arrêt du serveur'
  Arreter-Application

  Etape 'Chargement dans la base interne'
  $env:PGPASSWORD = $c['DB_PASSWORD']
  & (Join-Path $bin 'pg_restore.exe') -h $c['DB_HOST'] -p $c['DB_PORT'] -U $c['DB_USER'] -d $c['DB_NAME'] --clean --if-exists --no-owner --no-privileges $dump
  if ($LASTEXITCODE -ne 0) { Ecrire "pg_restore a signalé des avertissements (code $LASTEXITCODE) : vérifiez l'application après redémarrage." 'Yellow' }
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  if (Test-Path $dump) { Remove-Item $dump -Force }
}

Etape 'Redémarrage'
Demarrer-Application
$sch = $(if ($c['HTTPS_PFX_PATH']) { 'https' } else { 'http' })
$sante = Attendre-Sante "${sch}://localhost:$($c['PORT'])/api/health" 240
if (-not $sante -or $sante.base -ne 'ok') { Echec 'le serveur ne redémarre pas correctement : voir le journal.' }
Ecrire "Données reprises · base à jour ($($sante.derniere_migration)) · $($c['APP_URL'])" 'Green'
Ecrire 'Les comptes et mots de passe sont ceux de la version en ligne.'
Ecrire 'Les fichiers déposés en ligne (pièces jointes) restent chez l''hébergeur en ligne : voir le guide, section « Transfert ».'

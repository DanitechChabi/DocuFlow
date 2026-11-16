# ============================================================================
# restaurer.ps1 — remet la base (et, si fourni, les fichiers) dans l'état d'une
# sauvegarde. REMPLACE les données actuelles : à n'utiliser qu'après un
# incident, en administrateur.
#
#   .\restaurer.ps1 -Sauvegarde D:\Sauvegardes\DocuFlow\docuflow-2026-11-20_0200.dump `
#                   -Fichiers  D:\Sauvegardes\DocuFlow\fichiers-2026-11-20_0200.zip
# ============================================================================
param(
  [Parameter(Mandatory = $true)][string]$Sauvegarde,
  [string]$Fichiers,
  [string]$Dossier = 'C:\DocuFlow'
)
. (Join-Path $PSScriptRoot 'commun.ps1')
Verifier-Administrateur
if (-not (Test-Path $Sauvegarde)) { Echec "sauvegarde introuvable : $Sauvegarde" }
$c = Lire-Configuration (Join-Path $Dossier 'config\docuflow.env')
$bin = Trouver-PostgresBin $c['POSTGRES_BIN']

Ecrire "La base actuelle va être REMPLACÉE par : $Sauvegarde" 'Yellow'
if ((Read-Host 'Tapez RESTAURER pour confirmer') -ne 'RESTAURER') { Echec 'abandon : rien n''a été modifié.' }

Etape 'Sauvegarde de l''état actuel (au cas où)'
& (Join-Path $PSScriptRoot 'sauvegarder.ps1') -Dossier $Dossier

Etape 'Arrêt du serveur'
Arreter-Application

Etape 'Restauration de la base'
$env:PGPASSWORD = $c['DB_PASSWORD']
& (Join-Path $bin 'pg_restore.exe') -h $c['DB_HOST'] -p $c['DB_PORT'] -U $c['DB_USER'] -d $c['DB_NAME'] --clean --if-exists --no-owner --no-privileges $Sauvegarde
$code = $LASTEXITCODE
Remove-Item Env:\PGPASSWORD
if ($code -ne 0) { Ecrire "pg_restore a signalé des avertissements (code $code) : vérifiez l'application après redémarrage." 'Yellow' }

if ($Fichiers) {
  Etape 'Restauration des fichiers'
  if (-not (Test-Path $Fichiers)) { Echec "archive introuvable : $Fichiers" }
  $cible = $c['UPLOADS_DIR']
  $ancien = "$cible-avant-restauration-$(Get-Date -Format 'yyyyMMdd_HHmm')"
  if (Test-Path $cible) { Rename-Item $cible $ancien }
  New-Item -ItemType Directory -Force -Path $cible | Out-Null
  Expand-Archive -Path $Fichiers -DestinationPath $cible -Force
  Ecrire "Fichiers restaurés (les précédents sont gardés dans $ancien)." 'Green'
}

Etape 'Redémarrage'
Demarrer-Application
$sch = $(if ($c['HTTPS_PFX_PATH']) { 'https' } else { 'http' })
$sante = Attendre-Sante "${sch}://localhost:$($c['PORT'])/api/health" 180
if (-not $sante) { Echec 'le serveur ne répond pas : voir le journal.' }
Ecrire "Restauration terminée · $($c['APP_URL'])" 'Green'

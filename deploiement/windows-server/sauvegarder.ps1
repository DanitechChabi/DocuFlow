# ============================================================================
# sauvegarder.ps1 — sauvegarde la base et les fichiers de DocuFlow AFGC.
# Exécuté chaque nuit par la tâche « DocuFlow AFGC - Sauvegarde » ; peut aussi
# être lancé à la main (en administrateur) avant une intervention.
#
# Produit, dans le dossier de sauvegarde (SAUVEGARDE_DOSSIER) :
#   docuflow-AAAA-MM-JJ_HHmm.dump      la base (pg_dump, format personnalisé)
#   fichiers-AAAA-MM-JJ_HHmm.zip       les documents déposés (UPLOADS_DIR)
# Garde SAUVEGARDE_JOURS jours (30 par défaut). Ce dossier doit être copié
# hors du serveur (NAS, bande, autre site) par la politique de sauvegarde
# habituelle de la DSI : une sauvegarde sur le même disque ne protège pas
# d'une panne du serveur.
# ============================================================================
param([string]$Dossier = 'C:\DocuFlow')
. (Join-Path $PSScriptRoot 'commun.ps1')

$conf = Lire-Configuration (Join-Path $Dossier 'config\docuflow.env')
$bin = Trouver-PostgresBin $conf['POSTGRES_BIN']
$cible = $conf['SAUVEGARDE_DOSSIER']; if (-not $cible) { $cible = Join-Path $Dossier 'sauvegardes' }
$jours = 30; if ($conf['SAUVEGARDE_JOURS']) { $jours = [int]$conf['SAUVEGARDE_JOURS'] }
New-Item -ItemType Directory -Force -Path $cible | Out-Null
$horodatage = Get-Date -Format 'yyyy-MM-dd_HHmm'
$journal = Join-Path $cible 'sauvegardes.log'

function Noter([string]$t) { Add-Content -Path $journal -Value ("[{0}] {1}" -f (Get-Date -Format 's'), $t) -Encoding UTF8; Ecrire $t }

try {
  $env:PGPASSWORD = $conf['DB_PASSWORD']
  $dump = Join-Path $cible "docuflow-$horodatage.dump"
  & (Join-Path $bin 'pg_dump.exe') -h $conf['DB_HOST'] -p $conf['DB_PORT'] -U $conf['DB_USER'] -F c -f $dump $conf['DB_NAME']
  if ($LASTEXITCODE -ne 0) { throw "pg_dump a échoué (code $LASTEXITCODE)" }
  Noter ("Base sauvegardée : {0} ({1:N1} Mo)" -f $dump, ((Get-Item $dump).Length / 1MB))

  $fichiers = $conf['UPLOADS_DIR']
  if ($fichiers -and (Test-Path $fichiers) -and (Get-ChildItem $fichiers -Recurse -File | Select-Object -First 1)) {
    $zip = Join-Path $cible "fichiers-$horodatage.zip"
    Compress-Archive -Path (Join-Path $fichiers '*') -DestinationPath $zip -CompressionLevel Optimal -Force
    Noter ("Fichiers sauvegardés : {0} ({1:N1} Mo)" -f $zip, ((Get-Item $zip).Length / 1MB))
  }

  Get-ChildItem $cible -File | Where-Object { $_.Name -match '^(docuflow|fichiers)-' -and $_.LastWriteTime -lt (Get-Date).AddDays(-$jours) } |
    ForEach-Object { Remove-Item $_.FullName -Force; Noter "Ancienne sauvegarde retirée : $($_.Name)" }
} catch {
  Noter "ÉCHEC de la sauvegarde : $($_.Exception.Message)"
  exit 1
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

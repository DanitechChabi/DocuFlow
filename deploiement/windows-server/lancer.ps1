# ============================================================================
# lancer.ps1 — démarre le serveur DocuFlow AFGC et le relance s'il s'arrête.
# Exécuté par la tâche planifiée « DocuFlow AFGC » (compte SYSTEM, au
# démarrage de Windows). Les journaux vont dans <Dossier>\journaux, un
# fichier par jour, gardés 60 jours.
# ============================================================================
param([string]$Dossier = 'C:\DocuFlow')
. (Join-Path $PSScriptRoot 'commun.ps1')
$ErrorActionPreference = 'Continue'

$conf = Lire-Configuration (Join-Path $Dossier 'config\docuflow.env')
foreach ($cle in $conf.Keys) { [Environment]::SetEnvironmentVariable($cle, $conf[$cle], 'Process') }

$backend = Join-Path $Dossier 'app\backend'
$journaux = Join-Path $Dossier 'journaux'
New-Item -ItemType Directory -Force -Path $journaux | Out-Null
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }

while ($true) {
  Get-ChildItem $journaux -Filter '*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } | Remove-Item -Force -ErrorAction SilentlyContinue
  $journal = Join-Path $journaux ("docuflow-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
  Add-Content -Path $journal -Value ("[{0}] démarrage du serveur" -f (Get-Date -Format 's')) -Encoding UTF8
  Push-Location $backend
  # Par cmd.exe : la sortie de node reste en UTF-8 dans le journal (PowerShell 5.1
  # l'écrirait en UTF-16).
  & cmd.exe /d /c "`"$node`" src\app.js >> `"$journal`" 2>&1"
  $code = $LASTEXITCODE
  Pop-Location
  Add-Content -Path $journal -Value ("[{0}] arrêt du serveur (code {1}) — relance dans 10 s" -f (Get-Date -Format 's'), $code) -Encoding UTF8
  Start-Sleep -Seconds 10
}

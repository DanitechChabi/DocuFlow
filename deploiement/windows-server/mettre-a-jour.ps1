# ============================================================================
# mettre-a-jour.ps1 — installe une nouvelle version de DocuFlow AFGC.
# À lancer, en administrateur, depuis le dossier « scripts » du NOUVEAU paquet
# décompressé. La configuration et les données ne sont pas touchées ; la base
# est sauvegardée avant, et mise à jour par le serveur à son redémarrage.
# ============================================================================
param([string]$Dossier = 'C:\DocuFlow')
. (Join-Path $PSScriptRoot 'commun.ps1')
Verifier-Administrateur

$paquet = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $paquet 'app\backend\src\app.js'))) { Echec 'lancez ce script depuis le dossier « scripts » du nouveau paquet.' }
$fichierConf = Join-Path $Dossier 'config\docuflow.env'
if (-not (Test-Path $fichierConf)) { Echec "DocuFlow n'est pas installé dans $Dossier : utilisez installer.ps1." }
$c = Lire-Configuration $fichierConf

Etape 'Sauvegarde avant mise à jour'
& (Join-Path $PSScriptRoot 'sauvegarder.ps1') -Dossier $Dossier
if ($LASTEXITCODE -ne 0) { Echec 'la sauvegarde a échoué : mise à jour abandonnée, rien n''a été modifié.' }

Etape 'Arrêt du serveur'
Arreter-Application

Etape 'Copie de la nouvelle version'
$ancienne = Join-Path $Dossier ("app-precedente")
if (Test-Path $ancienne) { Remove-Item $ancienne -Recurse -Force }
Copy-Item (Join-Path $Dossier 'app') $ancienne -Recurse
& robocopy (Join-Path $paquet 'app') (Join-Path $Dossier 'app') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Echec "copie impossible (robocopy $LASTEXITCODE). L'ancienne version est dans $ancienne." }
& robocopy $PSScriptRoot (Join-Path $Dossier 'scripts') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null

Etape 'Redémarrage'
Demarrer-Application
$sch = $(if ($c['HTTPS_PFX_PATH']) { 'https' } else { 'http' })
$sante = Attendre-Sante "${sch}://localhost:$($c['PORT'])/api/health" 240
if (-not $sante -or $sante.base -ne 'ok' -or $sante.migration_en_echec) {
  Ecrire 'La nouvelle version ne démarre pas correctement. Pour revenir à la précédente :' 'Red'
  Ecrire "  1. arrêter la tâche « $NomTache » ;  2. remplacer $Dossier\app par $ancienne ;"
  Ecrire "  3. si la base a changé : .\restaurer.ps1 avec la sauvegarde de ce jour ;  4. redémarrer la tâche."
  Echec "voir le journal $Dossier\journaux\docuflow-$(Get-Date -Format 'yyyy-MM-dd').log"
}
Ecrire "Mise à jour terminée · base à jour ($($sante.derniere_migration)) · $($c['APP_URL'])" 'Green'

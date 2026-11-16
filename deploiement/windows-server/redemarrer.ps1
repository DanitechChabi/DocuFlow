# ============================================================================
# redemarrer.ps1 — redémarre le serveur DocuFlow AFGC et vérifie qu'il répond.
# En administrateur : C:\DocuFlow\scripts\redemarrer.ps1
# ============================================================================
param([string]$Dossier = 'C:\DocuFlow')
. (Join-Path $PSScriptRoot 'commun.ps1')
Verifier-Administrateur
$c = Lire-Configuration (Join-Path $Dossier 'config\docuflow.env')
Etape 'Arrêt'
Arreter-Application
Etape 'Démarrage'
Demarrer-Application
$sch = $(if ($c['HTTPS_PFX_PATH']) { 'https' } else { 'http' })
$sante = Attendre-Sante "${sch}://localhost:$($c['PORT'])/api/health" 180
if (-not $sante) { Echec "le serveur ne répond pas : voir $Dossier\journaux\docuflow-$(Get-Date -Format 'yyyy-MM-dd').log" }
Ecrire "Serveur en marche · base : $($sante.base) · $($c['APP_URL'])" 'Green'

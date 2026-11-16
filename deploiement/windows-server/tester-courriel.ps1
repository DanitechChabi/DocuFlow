# ============================================================================
# tester-courriel.ps1 — envoie un courriel d'essai avec la configuration du
# serveur (lignes SMTP_… de docuflow.env). En administrateur :
#   C:\DocuFlow\scripts\tester-courriel.ps1 -Adresse prenom.nom@afgcsa.com
# ============================================================================
param([Parameter(Mandatory = $true)][string]$Adresse, [string]$Dossier = 'C:\DocuFlow')
. (Join-Path $PSScriptRoot 'commun.ps1')
Verifier-Administrateur
$c = Lire-Configuration (Join-Path $Dossier 'config\docuflow.env')
foreach ($cle in $c.Keys) { [Environment]::SetEnvironmentVariable($cle, $c[$cle], 'Process') }
Push-Location (Join-Path $Dossier 'app\backend')
& node.exe 'scripts\tester-courriel.js' $Adresse
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Echec 'l''envoi a échoué (voir le message ci-dessus et la section « Courriels » du guide).' }
Ecrire 'Courriel d''essai envoyé : vérifiez la boîte de réception (et le dossier Courrier indésirable).' 'Green'

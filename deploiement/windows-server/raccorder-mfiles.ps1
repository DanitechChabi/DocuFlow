# ============================================================================
# raccorder-mfiles.ps1 — raccorde DocuFlow AFGC à M-Files (API REST) :
# écrit l'adresse, le coffre et le compte de service dans docuflow.env (le mot
# de passe est demandé au clavier, jamais passé en paramètre), teste la
# connexion, puis redémarre l'application. En administrateur :
#   C:\DocuFlow\scripts\raccorder-mfiles.ps1 -Adresse https://mfiles.afgc.local/REST `
#     -Coffre '{GUID-DU-COFFRE}' -Utilisateur svc-docuflow [-Domaine AFGC]
# ============================================================================
param(
  [Parameter(Mandatory = $true)][string]$Adresse,
  [Parameter(Mandatory = $true)][string]$Coffre,
  [Parameter(Mandatory = $true)][string]$Utilisateur,
  [string]$Domaine = '',
  [string]$Dossier = 'C:\DocuFlow'
)
. (Join-Path $PSScriptRoot 'commun.ps1')
Verifier-Administrateur
$fichierConf = Join-Path $Dossier 'config\docuflow.env'
if (-not (Test-Path $fichierConf)) { Echec "configuration introuvable : $fichierConf (installez d'abord l'application)." }
$secret = Read-Host -AsSecureString "Mot de passe du compte M-Files $Utilisateur"
$mdp = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret))
if (-not $mdp) { Echec 'mot de passe vide.' }

$nouvelles = [ordered]@{
  MFILES_REST_URL = $Adresse.TrimEnd('/')
  MFILES_VAULT_GUID = $Coffre
  MFILES_USERNAME = $Utilisateur
  MFILES_PASSWORD = $mdp
  MFILES_DOMAIN = $Domaine
}
$lignes = @(Get-Content $fichierConf | Where-Object { $_ -notmatch '^MFILES_' })
foreach ($k in $nouvelles.Keys) { if ($nouvelles[$k]) { $lignes += "$k=$($nouvelles[$k])" } }

Etape 'Test de la connexion à M-Files'
$c = Lire-Configuration $fichierConf
foreach ($cle in $c.Keys) { [Environment]::SetEnvironmentVariable($cle, $c[$cle], 'Process') }
foreach ($k in $nouvelles.Keys) { [Environment]::SetEnvironmentVariable($k, $nouvelles[$k], 'Process') }
Push-Location (Join-Path $Dossier 'app\backend')
& node.exe 'scripts\tester-mfiles.js'
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Echec 'M-Files refuse la connexion ou ne répond pas : rien n''a été modifié (voir le message ci-dessus).' }

[IO.File]::WriteAllLines($fichierConf, $lignes, (New-Object System.Text.UTF8Encoding($false)))
Ecrire "Configuration mise à jour : $fichierConf" 'Green'
Etape 'Redémarrage de l''application'
Arreter-Application
Demarrer-Application
Ecrire 'M-Files est raccordé : menu « Les fonds » → « Recherche M-Files ».' 'Green'

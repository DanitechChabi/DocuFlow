# ============================================================================
# installer-docubot.ps1 — installe le modèle de langue de DocuBot dans Ollama.
#
#   .\installer-docubot.ps1 -Paquet C:\Telechargements\docubot-afgc.zip
#       installe le modèle entraîné (produit par le carnet Colab) ;
#   .\installer-docubot.ps1 -Base
#       installe le modèle de départ, non entraîné (qwen3:4b-instruct, 2,5 Go,
#       téléchargé : il faut un accès à Internet pendant l'installation).
#
# Ollama tourne ensuite au démarrage de Windows (tâche « DocuBot Ollama »),
# sur ce serveur seulement (127.0.0.1:11434) : rien n'est ouvert sur le réseau.
# À lancer en administrateur. Puis, dans DocuFlow : Réglages → « DocuBot :
# modèle de langue » → adresse http://localhost:11434 → Tester la connexion.
# ============================================================================
param(
  [string]$Paquet = '',
  [switch]$Base,
  [string]$Nom = 'docubot-afgc',
  [string]$Dossier = 'C:\DocuFlow\ollama'
)
$ErrorActionPreference = 'Stop'
function Ecrire($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Echec($t) { Write-Host "ÉCHEC : $t" -ForegroundColor Red; exit 1 }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Echec 'lancez ce script en administrateur (clic droit → Exécuter en tant qu''administrateur).'
}
if (-not $Paquet -and -not $Base) { Echec 'indiquez -Paquet <docubot-afgc.zip> (modèle entraîné) ou -Base (modèle de départ).' }

# 1. Ollama installé ?
$ollama = (Get-Command ollama.exe -ErrorAction SilentlyContinue).Source
foreach ($c in @("$env:LOCALAPPDATA\Programs\Ollama\ollama.exe", "$env:ProgramFiles\Ollama\ollama.exe")) { if (-not $ollama -and (Test-Path $c)) { $ollama = $c } }
if (-not $ollama) {
  Ecrire 'Ollama n''est pas installé. Téléchargez-le sur https://ollama.com/download/windows (OllamaSetup.exe),' 'Yellow'
  Ecrire 'installez-le, fermez l''icône Ollama de la barre des tâches, puis relancez ce script.' 'Yellow'
  exit 1
}
Ecrire "Ollama : $ollama" 'Green'

# 2. Ollama au démarrage de Windows, sur ce serveur seulement.
$modeles = Join-Path $Dossier 'modeles'
New-Item -ItemType Directory -Force -Path $modeles | Out-Null
[Environment]::SetEnvironmentVariable('OLLAMA_MODELS', $modeles, 'Machine')
[Environment]::SetEnvironmentVariable('OLLAMA_HOST', '127.0.0.1:11434', 'Machine')
$env:OLLAMA_MODELS = $modeles
$env:OLLAMA_HOST = '127.0.0.1:11434'
$tache = 'DocuBot Ollama'
if (-not (Get-ScheduledTask -TaskName $tache -ErrorAction SilentlyContinue)) {
  $action = New-ScheduledTaskAction -Execute $ollama -Argument 'serve'
  $declencheur = New-ScheduledTaskTrigger -AtStartup
  $reglages = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $tache -Action $action -Trigger $declencheur -Settings $reglages -User 'SYSTEM' -RunLevel Highest | Out-Null
  Ecrire "Tâche « $tache » créée (Ollama démarre avec Windows)." 'Green'
}
Start-ScheduledTask -TaskName $tache
$pret = $false
for ($i = 0; $i -lt 30 -and -not $pret; $i++) {
  try { Invoke-RestMethod 'http://127.0.0.1:11434/api/version' -TimeoutSec 2 | Out-Null; $pret = $true } catch { Start-Sleep -Seconds 2 }
}
if (-not $pret) { Echec 'Ollama ne répond pas sur http://127.0.0.1:11434.' }

# 3. Le modèle.
if ($Base) {
  Ecrire 'Téléchargement du modèle de départ qwen3:4b-instruct (2,5 Go)…'
  & $ollama pull qwen3:4b-instruct
  if ($LASTEXITCODE -ne 0) { Echec 'téléchargement impossible (accès à Internet ?).' }
  $Nom = 'qwen3:4b-instruct'
} else {
  if (-not (Test-Path $Paquet)) { Echec "paquet introuvable : $Paquet" }
  $cible = Join-Path $Dossier $Nom
  if (Test-Path $cible) { Remove-Item $cible -Recurse -Force }
  Ecrire "Décompression de $Paquet…"
  Expand-Archive -Path $Paquet -DestinationPath $cible -Force
  if (-not (Test-Path (Join-Path $cible 'Modelfile'))) { Echec 'le paquet ne contient pas de Modelfile : est-ce bien le fichier produit par le carnet ?' }
  Push-Location $cible
  & $ollama create $Nom -f Modelfile
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { Echec "ollama create a échoué (code $code)." }
  Remove-Item (Join-Path $cible '*.gguf') -Force  # copié dans le dossier des modèles d'Ollama
}

# 4. Essai.
$corps = @{ model = $Nom; stream = $false; format = 'json'; options = @{ temperature = 0 }
  messages = @(@{ role = 'user'; content = 'Où est le dossier Credo BTP ? Réponds en JSON {"intention": ..., "entreprise": ...}' }) } | ConvertTo-Json -Depth 5
$debut = Get-Date
$r = Invoke-RestMethod 'http://127.0.0.1:11434/api/chat' -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($corps)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 300
Ecrire ("Essai ({0:N0} s) : {1}" -f ((Get-Date) - $debut).TotalSeconds, $r.message.content) 'Green'
Ecrire ''
Ecrire "Modèle « $Nom » installé." 'Green'
Ecrire 'Dans DocuFlow : Réglages → « DocuBot : modèle de langue » → adresse http://localhost:11434,'
Ecrire "modèle « $Nom » → Enregistrer → Tester la connexion."

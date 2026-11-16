# ============================================================================
# commun.ps1 — fonctions partagées par les scripts du serveur DocuFlow AFGC.
# Chargé par les autres scripts (". $PSScriptRoot\commun.ps1"), jamais seul.
# Compatible Windows PowerShell 5.1 (Windows Server 2016 et plus).
# ============================================================================
$ErrorActionPreference = 'Stop'

$NomTache = 'DocuFlow AFGC'
$NomTacheSauvegarde = 'DocuFlow AFGC - Sauvegarde'

function Ecrire([string]$texte, [string]$couleur = 'Gray') { Write-Host $texte -ForegroundColor $couleur }
function Etape([string]$texte) { Write-Host ''; Write-Host "==> $texte" -ForegroundColor Cyan }
function Echec([string]$texte) { Write-Host ''; Write-Host "ÉCHEC : $texte" -ForegroundColor Red; exit 1 }

function Verifier-Administrateur {
  $id = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $id.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Echec 'lancez PowerShell « en tant qu''administrateur ».'
  }
}

# Lit un fichier « CLE=valeur » (lignes vides et commentaires # ignorés).
function Lire-Configuration([string]$fichier) {
  if (-not (Test-Path $fichier)) { Echec "configuration introuvable : $fichier" }
  $conf = @{}
  foreach ($ligne in Get-Content -LiteralPath $fichier -Encoding UTF8) {
    $l = $ligne.Trim()
    if (-not $l -or $l.StartsWith('#')) { continue }
    $i = $l.IndexOf('=')
    if ($i -lt 1) { continue }
    $conf[$l.Substring(0, $i).Trim()] = $l.Substring($i + 1).Trim()
  }
  return $conf
}

# Dossier bin de PostgreSQL : celui de la configuration, sinon la version la plus récente installée.
function Trouver-PostgresBin([string]$indique) {
  if ($indique -and (Test-Path (Join-Path $indique 'psql.exe'))) { return $indique }
  $racine = Join-Path $env:ProgramFiles 'PostgreSQL'
  if (Test-Path $racine) {
    $versions = Get-ChildItem $racine -Directory | Sort-Object { [int]($_.Name -replace '\D', '') } -Descending
    foreach ($v in $versions) {
      $bin = Join-Path $v.FullName 'bin'
      if (Test-Path (Join-Path $bin 'psql.exe')) { return $bin }
    }
  }
  Echec "PostgreSQL introuvable. Installez-le (voir le guide), ou indiquez son dossier bin avec -PostgresBin."
}

# Mot de passe aléatoire, sans caractère gênant dans une URL ou un fichier de configuration.
function Nouveau-Secret([int]$octets = 32) {
  $b = New-Object byte[] $octets
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}

# Interroge /api/health (certificat interne accepté) ; renvoie l'objet ou $null.
function Lire-Sante([string]$url) {
  try {
    # PowerShell 7 : option native. Windows PowerShell 5.1 : politique temporaire.
    if ($PSVersionTable.PSVersion.Major -ge 6) { return Invoke-RestMethod -Uri $url -TimeoutSec 10 -SkipCertificateCheck }
    if (-not ('ConfianceTemporaire' -as [type])) {
      Add-Type @"
using System.Net; using System.Security.Cryptography.X509Certificates;
public class ConfianceTemporaire : ICertificatePolicy {
  public bool CheckValidationResult(ServicePoint s, X509Certificate c, WebRequest r, int p) { return true; }
}
"@
    }
    [System.Net.ServicePointManager]::CertificatePolicy = New-Object ConfianceTemporaire
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    return Invoke-RestMethod -Uri $url -TimeoutSec 10 -UseBasicParsing
  } catch { return $null }
}

function Attendre-Sante([string]$url, [int]$secondes = 120) {
  $fin = (Get-Date).AddSeconds($secondes)
  while ((Get-Date) -lt $fin) {
    $s = Lire-Sante $url
    if ($s -and $s.api -eq 'ok') { return $s }
    Start-Sleep -Seconds 3
  }
  return $null
}

function Arreter-Application {
  $t = Get-ScheduledTask -TaskName $NomTache -ErrorAction SilentlyContinue
  if ($t) { Stop-ScheduledTask -TaskName $NomTache -ErrorAction SilentlyContinue }
  # Le lanceur relance node en boucle : on arrête aussi le processus node de l'application.
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*DocuFlow*src\app.js*' -or $_.CommandLine -like '*DocuFlow*src/app.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

function Demarrer-Application { Start-ScheduledTask -TaskName $NomTache }

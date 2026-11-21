# Telecharge cloudflared.exe (le tunnel Cloudflare) dans vendor/, pour l'inclure dans l'installateur.
# Usage : npm run fetch:cloudflared   (ne retelecharge pas s'il est deja la)
#
# Source : les publications officielles de Cloudflare sur GitHub (licence Apache 2.0).
$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $project "vendor"
$target = Join-Path $vendor "cloudflared.exe"
$url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

if (Test-Path $target) {
  Write-Host "cloudflared.exe deja present : $target"
  exit 0
}

New-Item -ItemType Directory -Force $vendor | Out-Null
Write-Host "Telechargement de cloudflared depuis $url ..."
Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing

# Verification : le fichier doit etre signe par Cloudflare (signature Authenticode valide)
$signature = Get-AuthenticodeSignature $target
if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch "Cloudflare") {
  Remove-Item $target -Force
  throw "Signature de cloudflared.exe invalide ou inattendue ($($signature.Status)) : fichier supprime."
}
Write-Host "cloudflared.exe telecharge et verifie (signe par Cloudflare) : $target"

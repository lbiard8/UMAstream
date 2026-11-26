# Genere l'icone PNG carree (512 x 512) utilisee par macOS (converti en .icns par electron-builder)
# et par Linux (AppImage, fenetre de l'appli), a partir d'une image PNG.
# Usage : powershell -File scripts/make-png-icon.ps1 <image.png> assets/umastream.png
# Conseil : partir d'une image d'au moins 512 px, sinon l'icone sera un peu floue.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Output,
  [int]$Size = 512
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path $Source).Path)
$bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

# L'image n'est pas forcement carree : on l'agrandit sans la deformer et on la centre
$scale = [Math]::Min($Size / $sourceImage.Width, $Size / $sourceImage.Height)
$width = [int]($sourceImage.Width * $scale)
$height = [int]($sourceImage.Height * $scale)
$graphics.DrawImage($sourceImage, [int](($Size - $width) / 2), [int](($Size - $height) / 2), $width, $height)

$graphics.Dispose()
$bitmap.Save((Join-Path (Get-Location) $Output), [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
$sourceImage.Dispose()
Write-Host "Icone PNG $Size x $Size creee : $Output"

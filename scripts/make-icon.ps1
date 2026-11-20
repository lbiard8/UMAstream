# Genere l'icone Windows (.ico) du raccourci a partir d'une image PNG.
# Usage : npm run icon   (ou : powershell -File scripts/make-icon.ps1 <image.png> <sortie.ico>)
#
# Un fichier .ico contient plusieurs tailles de la meme image : Windows choisit la bonne
# selon l'endroit (16 px dans l'explorateur, 48 px sur le bureau, 256 px en grandes icones).
# Comme dans les icones de Windows lui-meme : les petites tailles sont stockees en BMP
# (le format historique, compris partout), et seul le 256 px est stocke en PNG.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Output
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$sizes = @(16, 24, 32, 48, 64, 128, 256)
# Attention : en PowerShell, $sourceImage et $Source sont deux variables differentes,
# mais $source et $Source seraient LA MEME (les noms ne tiennent pas compte des majuscules).
$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path $Source).Path)
$images = New-Object System.Collections.Generic.List[byte[]]

foreach ($size in $sizes) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  # L'image n'est pas forcement carree : on la reduit sans la deformer et on la centre
  $scale = [Math]::Min($size / $sourceImage.Width, $size / $sourceImage.Height)
  $width = [int][Math]::Round($sourceImage.Width * $scale)
  $height = [int][Math]::Round($sourceImage.Height * $scale)
  $graphics.DrawImage($sourceImage, [int](($size - $width) / 2), [int](($size - $height) / 2), $width, $height)

  $stream = New-Object System.IO.MemoryStream
  if ($size -eq 256) {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  } else {
    # BMP d'icone : en-tete de 40 octets, pixels BGRA de bas en haut, puis un "masque" de 1 bit par pixel
    $writer = New-Object System.IO.BinaryWriter $stream
    $writer.Write([UInt32]40)            # taille de l'en-tete
    $writer.Write([Int32]$size)          # largeur
    $writer.Write([Int32]($size * 2))    # hauteur x2 : image + masque (convention des icones)
    $writer.Write([UInt16]1)             # plans
    $writer.Write([UInt16]32)            # 32 bits par pixel (avec transparence)
    $writer.Write([UInt32]0)             # pas de compression
    $writer.Write([UInt32]0); $writer.Write([Int32]0); $writer.Write([Int32]0)
    $writer.Write([UInt32]0); $writer.Write([UInt32]0)
    for ($y = $size - 1; $y -ge 0; $y--) {
      for ($x = 0; $x -lt $size; $x++) {
        $pixel = $bitmap.GetPixel($x, $y)
        $writer.Write([byte]$pixel.B); $writer.Write([byte]$pixel.G)
        $writer.Write([byte]$pixel.R); $writer.Write([byte]$pixel.A)
      }
    }
    # Masque tout a 0 : la transparence est deja donnee par le canal alpha
    $maskRowBytes = [int]([Math]::Ceiling($size / 32) * 4)
    $writer.Write((New-Object byte[] ($maskRowBytes * $size)))
    $writer.Flush()
  }
  $images.Add($stream.ToArray())
  $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose()
}
$sourceImage.Dispose()

# Format .ico : un en-tete (6 octets), une fiche de 16 octets par taille, puis les images
$file = [System.IO.File]::Create((Join-Path (Get-Location) $Output))
$writer = New-Object System.IO.BinaryWriter $file
$writer.Write([UInt16]0)               # reserve
$writer.Write([UInt16]1)               # type 1 = icone
$writer.Write([UInt16]$sizes.Count)    # nombre d'images
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $size = $sizes[$i]
  $sizeByte = [byte]($size % 256)      # 256 s'ecrit 0 dans le format .ico
  $writer.Write($sizeByte)             # largeur
  $writer.Write($sizeByte)             # hauteur
  $writer.Write([byte]0)               # nombre de couleurs (0 = image en couleurs vraies)
  $writer.Write([byte]0)               # reserve
  $writer.Write([UInt16]1)             # plans
  $writer.Write([UInt16]32)            # bits par pixel
  $writer.Write([UInt32]$images[$i].Length)
  $writer.Write([UInt32]$offset)
  $offset += $images[$i].Length
}
foreach ($image in $images) { $writer.Write($image) }
$writer.Close()
Write-Host "Icone creee : $Output ($($sizes -join ', ') px)"

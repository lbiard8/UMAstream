# Cree le raccourci "UMAstream" sur le bureau de l'utilisateur.
# Usage : npm run shortcut   (a relancer si le dossier du projet est deplace)
#
# Chacun installe UMAstream dans un dossier different : ce script construit le raccourci
# avec le bon chemin, quel que soit le PC.
$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $PSScriptRoot
# GetFolderPath("Desktop") donne le VRAI bureau, meme s'il est synchronise par OneDrive
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "UMAstream.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $project "UMAstream.cmd"
$shortcut.WorkingDirectory = $project
$shortcut.IconLocation = (Join-Path $project "assets\umastream.ico") + ",0"
$shortcut.WindowStyle = 7   # 7 = fenetre reduite dans la barre des taches
$shortcut.Description = "Lancer UMAstream (partage d'ecran)"
$shortcut.Save()

Write-Host "Raccourci cree : $shortcutPath"

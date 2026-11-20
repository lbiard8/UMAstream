@echo off
rem Lanceur UMAstream : un double-clic (ou l'icône du bureau) lance le serveur + le tunnel,
rem puis ouvre la page dans le navigateur. Fermer cette fenêtre arrête UMAstream.

rem Affichage des accents dans la fenêtre
chcp 65001 >nul
title UMAstream

rem Se placer dans le dossier du projet (celui de ce fichier), d'où qu'on le lance
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installé. Télécharge-le sur https://nodejs.org puis relance UMAstream.
  pause
  exit /b 1
)

rem Première utilisation : on installe les dépendances
if not exist "node_modules" (
  echo Première utilisation : installation des dépendances...
  call npm install
  if errorlevel 1 (
    echo L'installation a échoué.
    pause
    exit /b 1
  )
)

rem "--" transmet --open au serveur : il ouvrira le navigateur une fois prêt
call npm run share -- --open

rem En cas d'erreur, on garde la fenêtre ouverte pour pouvoir lire le message
if errorlevel 1 pause

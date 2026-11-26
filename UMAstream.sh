#!/usr/bin/env bash
# Lanceur UMAstream (version navigateur) pour macOS et Linux : l'équivalent de UMAstream.cmd.
# Lance le serveur + le tunnel, puis ouvre la page dans le navigateur. Ctrl+C (ou fermer le
# terminal) arrête UMAstream.
#
# Première fois : rendre le fichier exécutable avec   chmod +x UMAstream.sh
# Ensuite :       ./UMAstream.sh

# Se placer dans le dossier du projet (celui de ce fichier), d'où qu'on le lance
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Télécharge-le sur https://nodejs.org puis relance UMAstream."
  exit 1
fi

# Première utilisation : on installe les dépendances
if [ ! -d node_modules ]; then
  echo "Première utilisation : installation des dépendances..."
  npm install || { echo "L'installation a échoué."; exit 1; }
fi

# "--" transmet --open au serveur : il ouvrira le navigateur une fois prêt
npm run share -- --open

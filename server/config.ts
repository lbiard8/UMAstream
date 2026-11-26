// Réglages du serveur, lus au démarrage (arguments de la commande et variables d'environnement).
// L'application de bureau règle les variables d'environnement AVANT de charger le serveur.

import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PORT = Number(process.env.PORT ?? 3000);
// `npm run share` ajoute --tunnel : on crée alors une adresse publique via Cloudflare
// (l'application de bureau, elle, passe par la variable d'environnement UMASTREAM_TUNNEL=1)
export const WANT_TUNNEL = process.argv.includes("--tunnel") || process.env.UMASTREAM_TUNNEL === "1";
// Lancé par l'application de bureau (Electron) : pas de process.exit(), on signale plutôt les erreurs
export const EMBEDDED = process.env.UMASTREAM_EMBEDDED === "1";
// `--open` (ajouté par le lanceur UMAstream.cmd) : ouvrir la page dans le navigateur une fois prêt
export const WANT_OPEN = process.argv.includes("--open");
export const LOCAL_URL = `http://localhost:${PORT}`;

// Dossier des fichiers du site. L'application de bureau indique le sien (il est dans l'appli installée).
export const PUBLIC_DIR = process.env.UMASTREAM_PUBLIC_DIR
  ? join(process.env.UMASTREAM_PUBLIC_DIR, sep)
  : fileURLToPath(new URL("../public/", import.meta.url));

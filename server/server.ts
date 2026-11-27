// Serveur UMAstream : il sert les fichiers du site ET fait la "signalisation" WebRTC.
// Important : la vidéo ne passe JAMAIS par ici. Le serveur ne fait que mettre
// les navigateurs en relation, ensuite ils se parlent en direct (pair à pair).
//
// Ce fichier ne fait que démarrer et brancher les morceaux :
//   config.ts        réglages (port, tunnel, dossier public…)
//   static-files.ts  les fichiers du site
//   signaling.ts     les connexions WebSocket -> handlers.ts (un gestionnaire par message)
//   rooms.ts         les salons, la salle d'attente, les reconnexions
//   keepalive.ts     le ping toutes les 30 s
//   network.ts       l'IP locale et le tunnel Cloudflare

import { createServer } from "node:http";
import type { ShareReach } from "../shared/messages.js";
import { EMBEDDED, LOCAL_URL, PORT, PUBLIC_DIR, WANT_OPEN, WANT_TUNNEL } from "./config.js";
import { getLanIp, startTunnel } from "./network.js";
import { openBrowser } from "./open-browser.js";
import { allowedOrigins } from "./origin.js";
import { startSignaling } from "./signaling.js";
import { staticFiles } from "./static-files.js";

/** Adresse publique du tunnel, connue quelques secondes après le démarrage. */
let tunnelUrl: string | null = null;
const lanIp = await getLanIp();

/** Début du lien à partager : le plus "large" possible (internet > réseau local > ce PC). */
function shareInfo(): { shareBase?: string; reach: ShareReach } {
  if (tunnelUrl) return { shareBase: tunnelUrl, reach: "internet" };
  if (lanIp) return { shareBase: `http://${lanIp}:${PORT}`, reach: "lan" };
  return { reach: "local" };
}

/** Résolu quand le serveur écoute (et que le tunnel est prêt ou a échoué). Utilisé par l'appli de bureau. */
let markReady!: (info: { port: number; tunnelUrl: string | null }) => void;
let markFailed!: (err: Error) => void;
export const serverReady = new Promise<{ port: number; tunnelUrl: string | null }>((resolve, reject) => {
  markReady = resolve;
  markFailed = reject;
});

const httpServer = createServer(staticFiles(PUBLIC_DIR));
const wss = startSignaling(httpServer, {
  port: PORT,
  shareInfo,
  allowedOrigins: () => allowedOrigins(PORT, lanIp, tunnelUrl),
});

// Port déjà utilisé : le plus souvent, UMAstream tourne déjà (double-clic sur l'icône alors qu'il est
// ouvert). Au lieu de planter, on ouvre la page existante et on s'arrête proprement.
// (Le serveur WebSocket fait remonter les erreurs du serveur HTTP : c'est donc lui qu'on écoute.)
wss.on("error", (err: NodeJS.ErrnoException) => {
  if (EMBEDDED) return markFailed(err); // l'appli de bureau affiche elle-même le problème
  if (err.code === "EADDRINUSE") {
    console.log(`UMAstream tourne déjà sur le port ${PORT} : ouverture de la page existante.`);
    if (WANT_OPEN) openBrowser(LOCAL_URL);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});

httpServer.listen(PORT, async () => {
  console.log(`UMAstream prêt sur ${LOCAL_URL}`);
  if (lanIp) console.log(`  Réseau local : http://${lanIp}:${PORT}`);

  if (WANT_TUNNEL) {
    console.log("  Ouverture du tunnel Cloudflare…");
    tunnelUrl = await startTunnel(PORT);
    if (tunnelUrl) console.log(`  Internet     : ${tunnelUrl}   ← les liens générés utiliseront cette adresse`);
  } else {
    console.log("  (Pour un lien accessible depuis internet : npm run share)");
  }

  // Après le tunnel : ainsi, le lien généré dans la page utilise déjà l'adresse internet
  if (WANT_OPEN) openBrowser(LOCAL_URL);
  if (!EMBEDDED) console.log("\nPour arrêter UMAstream : ferme cette fenêtre (ou Ctrl+C).");
  markReady({ port: PORT, tunnelUrl });
});

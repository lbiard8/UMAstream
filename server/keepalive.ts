// Maintien des connexions ("ping").
//
// Une connexion qui ne transporte plus rien est coupée par les relais : le tunnel Cloudflare coupe
// un WebSocket inactif au bout d'environ 2 minutes (mesuré : 125 s). Une fois la vidéo lancée, la
// connexion d'un spectateur avec le serveur ne sert presque plus… et il était éjecté (issue #23).
// Toutes les 30 s, le serveur envoie donc un "ping" à chaque connexion ; le navigateur répond tout
// seul par un "pong". Une connexion qui n'a pas répondu au ping précédent est morte : on la ferme.

import type { WebSocket, WebSocketServer } from "ws";

const PING_INTERVAL_MS = 30_000;

export class KeepAlive {
  private readonly answeredLastPing = new WeakMap<WebSocket, boolean>();

  constructor(wss: WebSocketServer) {
    const timer = setInterval(() => {
      for (const client of wss.clients) {
        if (this.answeredLastPing.get(client) === false) {
          client.terminate(); // pas de réponse depuis 30 s : connexion morte
          continue;
        }
        this.answeredLastPing.set(client, false);
        client.ping();
      }
    }, PING_INTERVAL_MS);
    wss.on("close", () => clearInterval(timer));
  }

  /** À appeler pour chaque nouvelle connexion. */
  watch(ws: WebSocket) {
    this.answeredLastPing.set(ws, true);
    ws.on("pong", () => this.answeredLastPing.set(ws, true));
  }
}

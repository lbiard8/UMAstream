// D'où vient une connexion : son adresse IP réelle, et si elle vient de CE PC.

import type { IncomingMessage } from "node:http";

function isLoopback(ip: string | undefined): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/**
 * Adresse IP réelle du visiteur.
 * Via le tunnel, TOUT le monde arrive depuis cloudflared, qui tourne sur ce PC (127.0.0.1) :
 * sans précaution, tous les spectateurs auraient la même IP et un seul bloquerait tout le monde.
 * Cloudflare transmet donc la vraie IP dans l'en-tête "cf-connecting-ip". On ne lui fait confiance
 * QUE si la connexion vient de ce PC : sinon n'importe qui pourrait l'inventer pour contourner le blocage.
 */
export function clientIp(req: IncomingMessage): string {
  const socketIp = req.socket.remoteAddress ?? "inconnue";
  const cloudflareIp = req.headers["cf-connecting-ip"];
  if (isLoopback(socketIp) && typeof cloudflareIp === "string" && cloudflareIp) return cloudflareIp;
  return socketIp;
}

/**
 * La connexion vient-elle vraiment de CE PC (page ouverte sur http://localhost) ?
 * - via le tunnel : la connexion arrive aussi de 127.0.0.1 (c'est cloudflared), MAIS avec l'en-tête
 *   "cf-connecting-ip" que Cloudflare ajoute toujours -> ce n'est pas ce PC ;
 * - depuis le réseau local : l'adresse n'est pas 127.0.0.1 -> ce n'est pas ce PC.
 */
export function isFromThisPc(req: IncomingMessage): boolean {
  return isLoopback(req.socket.remoteAddress) && req.headers["cf-connecting-ip"] === undefined;
}

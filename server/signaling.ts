// Signalisation WebSocket : accepter les connexions (avec les plafonds anti-abus), les maintenir
// en vie, lire leurs messages et les confier au bon gestionnaire (handlers.ts).

import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ShareReach } from "../shared/messages.js";
import { dispatch } from "../shared/dispatch.js";
import { clientIp, isFromThisPc } from "./client-ip.js";
import { createHandlers } from "./handlers.js";
import { KeepAlive } from "./keepalive.js";
import { ConnectionCounter, MAX_CONNECTIONS_PER_IP, MAX_CONNECTIONS_TOTAL } from "./limits.js";
import { RoomRegistry } from "./rooms.js";
import { send } from "./send.js";

// maxPayload : taille max d'un message. Par défaut, la bibliothèque ws accepte jusqu'à 100 Mo,
// ce qui permettrait à n'importe qui de remplir la mémoire de ce PC avec quelques messages énormes.
// Nos plus gros messages (les offres WebRTC) font moins de 10 Ko : 64 Ko laisse une large marge.
// Au-delà, ws ferme la connexion tout seul (code 1009 "message trop gros").
const MAX_MESSAGE_BYTES = 64 * 1024;

export interface SignalingOptions {
  port: number;
  shareInfo(): { shareBase?: string; reach: ShareReach };
}

export function startSignaling(httpServer: Server, { port, shareInfo }: SignalingOptions): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });
  const keepAlive = new KeepAlive(wss);
  const rooms = new RoomRegistry();
  const ipOf = new WeakMap<WebSocket, string>(); // adresse IP de chaque connexion
  // Connexions ouvertes depuis ce PC : les SEULES autorisées à créer un salon (à streamer)
  const localConnections = new WeakSet<WebSocket>();
  const connectionsByIp = new ConnectionCounter();

  const handlers = createHandlers({
    rooms,
    ipOf: (ws) => ipOf.get(ws) ?? "inconnue",
    isLocal: (ws) => localConnections.has(ws),
    shareInfo,
    port,
  });

  wss.on("connection", (ws, req) => {
    const ip = clientIp(req);
    ipOf.set(ws, ip);

    // INDISPENSABLE, et EN PREMIER : en Node, une erreur sans écouteur fait planter TOUT le serveur.
    // Sans ces lignes, un seul message mal formé (ou trop gros) envoyé par n'importe qui
    // couperait le stream pour tout le monde. Ici, seule la connexion fautive est fermée
    // (ws la ferme tout seul) et le serveur continue. Placé avant les refus ci-dessous,
    // pour protéger aussi les connexions refusées.
    ws.on("error", (err) => {
      console.warn(`Connexion fermée sur erreur (${ip}) : ${err.message}`);
    });

    // Plafonds de connexions : au-delà, on explique pourquoi et on ferme (code 1008 = "règle non respectée")
    const refuse = (message: string) => {
      console.warn(`Connexion refusée (${ip}) : ${message}`);
      send(ws, { type: "error", message });
      ws.close(1008, "Trop de connexions");
    };
    // wss.clients contient déjà cette nouvelle connexion, d'où le ">"
    if (wss.clients.size > MAX_CONNECTIONS_TOTAL) return refuse("Serveur plein, réessaie plus tard.");
    if (connectionsByIp.count(ip) >= MAX_CONNECTIONS_PER_IP) {
      return refuse("Trop de connexions depuis ton adresse : ferme quelques onglets UMAstream.");
    }
    connectionsByIp.add(ip);
    ws.once("close", () => connectionsByIp.remove(ip)); // compté une fois, décompté une fois

    if (isFromThisPc(req)) localConnections.add(ws);
    keepAlive.watch(ws);

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(ws, { type: "error", message: "Message illisible" });
      }
      // Promise.resolve().then : une erreur (même dans un gestionnaire synchrone) est juste affichée
      Promise.resolve()
        .then(() => dispatch(handlers, msg, ws))
        .catch((err) => console.error(err));
    });

    ws.on("close", () => rooms.disconnect(ws));
  });

  return wss;
}

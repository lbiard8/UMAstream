// Serveur UMAstream : il sert les fichiers du site ET fait la "signalisation" WebRTC.
// Important : la vidéo ne passe JAMAIS par ici. Le serveur ne fait que mettre
// les navigateurs en relation, ensuite ils se parlent en direct (pair à pair).

import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage, ShareReach } from "../shared/messages.js";
import { getLanIp, startTunnel } from "./network.js";
import {
  AttemptLimiter,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  verifyPassword,
  type PasswordHash,
} from "./password.js";

const PORT = Number(process.env.PORT ?? 3000);
// `npm run share` ajoute --tunnel : on crée alors une adresse publique via Cloudflare
const WANT_TUNNEL = process.argv.includes("--tunnel");

/** Adresse publique du tunnel, connue quelques secondes après le démarrage. */
let tunnelUrl: string | null = null;
const lanIp = await getLanIp();

/** Début du lien à partager : le plus "large" possible (internet > réseau local > ce PC). */
function shareInfo(): { shareBase?: string; reach: ShareReach } {
  if (tunnelUrl) return { shareBase: tunnelUrl, reach: "internet" };
  if (lanIp) return { shareBase: `http://${lanIp}:${PORT}`, reach: "lan" };
  return { reach: "local" };
}
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

// ---------------------------------------------------------------------------
// 1. Fichiers statiques (main-page.html, app.js, style.css)
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".svg": "image/svg+xml",
};

const httpServer = createServer(async (req, res) => {
  const urlPath = new URL(req.url ?? "/", "http://localhost").pathname;
  // "/" (accueil, et tous les liens de stream "/?room=…") -> la page principale
  const relative = urlPath === "/" ? "main-page.html" : urlPath.slice(1);
  const filePath = normalize(join(PUBLIC_DIR, relative));

  // Empêche de sortir du dossier public avec des "../"
  if (!filePath.startsWith(PUBLIC_DIR.replace(/[\\/]$/, "") + sep)) {
    res.writeHead(403).end("Interdit");
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404).end("Introuvable");
  }
});

// ---------------------------------------------------------------------------
// 2. Signalisation WebSocket
// ---------------------------------------------------------------------------

interface Room {
  streamer: WebSocket;
  viewers: Map<string, WebSocket>; // viewerId -> connexion
  password: PasswordHash; // empreinte du mot de passe, jamais le mot de passe en clair
}

/** Ce qu'on sait de chaque connexion. */
interface PeerInfo {
  id: string;
  roomId: string;
  role: "streamer" | "viewer";
}

const rooms = new Map<string, Room>();
const peers = new Map<WebSocket, PeerInfo>();
const ipOf = new WeakMap<WebSocket, string>(); // adresse IP de chaque connexion
// Connexions dont une demande (création ou mot de passe) est en cours de traitement :
// on ignore leurs autres demandes, pour qu'on ne puisse pas tester 50 mots de passe en parallèle.
const busy = new WeakSet<WebSocket>();
const limiter = new AttemptLimiter();

const newId = () => randomBytes(4).toString("hex"); // ex : "9f3a1c07"
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Adresse IP réelle du visiteur.
 * Via le tunnel, TOUT le monde arrive depuis cloudflared, qui tourne sur ce PC (127.0.0.1) :
 * sans précaution, tous les spectateurs auraient la même IP et un seul bloquerait tout le monde.
 * Cloudflare transmet donc la vraie IP dans l'en-tête "cf-connecting-ip". On ne lui fait confiance
 * QUE si la connexion vient de ce PC : sinon n'importe qui pourrait l'inventer pour contourner le blocage.
 */
function clientIp(req: IncomingMessage): string {
  const socketIp = req.socket.remoteAddress ?? "inconnue";
  const fromThisPc = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
  const cloudflareIp = req.headers["cf-connecting-ip"];
  if (fromThisPc && typeof cloudflareIp === "string" && cloudflareIp) return cloudflareIp;
  return socketIp;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  ipOf.set(ws, clientIp(req));

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: "error", message: "Message illisible" });
    }
    handleMessage(ws, msg).catch((err) => console.error(err));
  });

  ws.on("close", () => handleDisconnect(ws));
});

async function handleMessage(ws: WebSocket, msg: ClientMessage) {
  const me = peers.get(ws);

  switch (msg.type) {
    case "create-room": {
      if (me) return send(ws, { type: "error", message: "Déjà dans un salon" });
      if (busy.has(ws)) return;
      // On ne fait jamais confiance au client : on revérifie ici ce que la page a déjà vérifié
      if (typeof msg.password !== "string" || msg.password.length === 0) {
        return send(ws, { type: "error", message: "Un mot de passe est obligatoire" });
      }
      if (msg.password.length > MAX_PASSWORD_LENGTH) {
        return send(ws, { type: "error", message: `Mot de passe trop long (${MAX_PASSWORD_LENGTH} caractères max)` });
      }
      busy.add(ws);
      try {
        const password = await hashPassword(msg.password);
        if (ws.readyState !== WebSocket.OPEN) return; // le streamer est parti pendant le hachage
        const roomId = newId();
        rooms.set(roomId, { streamer: ws, viewers: new Map(), password });
        peers.set(ws, { id: "streamer", roomId, role: "streamer" });
        send(ws, { type: "room-created", roomId, ...shareInfo() });
        console.log(`[salon ${roomId}] créé`);
      } finally {
        busy.delete(ws);
      }
      break;
    }

    case "join-room": {
      if (me) return send(ws, { type: "error", message: "Déjà dans un salon" });
      if (busy.has(ws)) return; // un essai est déjà en cours pour cette connexion
      const room = rooms.get(msg.roomId);
      if (!room) return send(ws, { type: "error", message: "Ce salon n'existe pas (ou le stream est terminé)" });

      const ip = ipOf.get(ws) ?? "inconnue";
      const blockedFor = limiter.blockedFor(ip);
      if (blockedFor > 0) {
        send(ws, { type: "blocked", retryAfterSeconds: blockedFor });
        ws.close();
        return;
      }
      // Premier contact (pas encore de mot de passe) : on demande le mot de passe, sans compter d'essai
      if (typeof msg.password !== "string" || msg.password.length === 0) {
        return send(ws, { type: "password-required" });
      }

      busy.add(ws);
      try {
        await sleep(limiter.delayMs(ip)); // pause croissante après chaque erreur
        const ok = await verifyPassword(msg.password.slice(0, MAX_PASSWORD_LENGTH), room.password);
        if (ws.readyState !== WebSocket.OPEN) return;

        if (!ok) {
          const attemptsLeft = limiter.fail(ip);
          console.log(`[salon ${msg.roomId}] mot de passe faux depuis ${ip} (${attemptsLeft} essai(s) restant(s))`);
          if (attemptsLeft === 0) {
            send(ws, { type: "blocked", retryAfterSeconds: limiter.blockedFor(ip) });
            ws.close();
          } else {
            send(ws, { type: "password-wrong", attemptsLeft });
          }
          return;
        }
        limiter.succeed(ip);

        // Le salon a pu fermer pendant la vérification
        const current = rooms.get(msg.roomId);
        if (!current) return send(ws, { type: "error", message: "Le stream vient de se terminer" });

        const viewerId = newId();
        current.viewers.set(viewerId, ws);
        peers.set(ws, { id: viewerId, roomId: msg.roomId, role: "viewer" });
        send(ws, { type: "joined", roomId: msg.roomId });
        // C'est SEULEMENT maintenant que le streamer est prévenu et lance la connexion WebRTC
        send(current.streamer, { type: "viewer-joined", viewerId });
        console.log(`[salon ${msg.roomId}] spectateur ${viewerId} arrivé (${current.viewers.size} au total)`);
      } finally {
        busy.delete(ws);
      }
      break;
    }

    case "signal": {
      if (!me) return;
      const room = rooms.get(me.roomId);
      if (!room) return;
      // Un spectateur ne peut parler qu'au streamer, le streamer à ses spectateurs.
      const target = me.role === "viewer" ? room.streamer : room.viewers.get(msg.to);
      if (target) send(target, { type: "signal", from: me.id, data: msg.data });
      break;
    }
  }
}

function handleDisconnect(ws: WebSocket) {
  const me = peers.get(ws);
  if (!me) return;
  peers.delete(ws);
  const room = rooms.get(me.roomId);
  if (!room) return;

  if (me.role === "streamer") {
    // Le streamer part : on ferme le salon et on prévient tout le monde
    for (const viewer of room.viewers.values()) {
      send(viewer, { type: "stream-ended" });
      peers.delete(viewer);
    }
    rooms.delete(me.roomId);
    console.log(`[salon ${me.roomId}] fermé`);
  } else {
    room.viewers.delete(me.id);
    send(room.streamer, { type: "viewer-left", viewerId: me.id });
    console.log(`[salon ${me.roomId}] spectateur ${me.id} parti`);
  }
}

httpServer.listen(PORT, async () => {
  console.log(`UMAstream prêt sur http://localhost:${PORT}`);
  if (lanIp) console.log(`  Réseau local : http://${lanIp}:${PORT}`);

  if (WANT_TUNNEL) {
    console.log("  Ouverture du tunnel Cloudflare…");
    tunnelUrl = await startTunnel(PORT);
    if (tunnelUrl) console.log(`  Internet     : ${tunnelUrl}   ← les liens générés utiliseront cette adresse`);
  } else {
    console.log("  (Pour un lien accessible depuis internet : npm run share)");
  }
});

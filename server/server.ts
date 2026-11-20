// Serveur UMAstream : il sert les fichiers du site ET fait la "signalisation" WebRTC.
// Important : la vidéo ne passe JAMAIS par ici. Le serveur ne fait que mettre
// les navigateurs en relation, ensuite ils se parlent en direct (pair à pair).

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage, ShareReach } from "../shared/messages.js";
import { getLanIp, startTunnel } from "./network.js";

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
// 1. Fichiers statiques (index.html, app.js, style.css)
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
  const relative = urlPath === "/" ? "index.html" : urlPath.slice(1);
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
}

/** Ce qu'on sait de chaque connexion. */
interface PeerInfo {
  id: string;
  roomId: string;
  role: "streamer" | "viewer";
}

const rooms = new Map<string, Room>();
const peers = new Map<WebSocket, PeerInfo>();

const newId = () => randomBytes(4).toString("hex"); // ex : "9f3a1c07"

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: "error", message: "Message illisible" });
    }
    handleMessage(ws, msg);
  });

  ws.on("close", () => handleDisconnect(ws));
});

function handleMessage(ws: WebSocket, msg: ClientMessage) {
  const me = peers.get(ws);

  switch (msg.type) {
    case "create-room": {
      if (me) return send(ws, { type: "error", message: "Déjà dans un salon" });
      const roomId = newId();
      rooms.set(roomId, { streamer: ws, viewers: new Map() });
      peers.set(ws, { id: "streamer", roomId, role: "streamer" });
      send(ws, { type: "room-created", roomId, ...shareInfo() });
      console.log(`[salon ${roomId}] créé`);
      break;
    }

    case "join-room": {
      if (me) return send(ws, { type: "error", message: "Déjà dans un salon" });
      const room = rooms.get(msg.roomId);
      if (!room) return send(ws, { type: "error", message: "Ce salon n'existe pas (ou le stream est terminé)" });
      const viewerId = newId();
      room.viewers.set(viewerId, ws);
      peers.set(ws, { id: viewerId, roomId: msg.roomId, role: "viewer" });
      send(ws, { type: "joined", roomId: msg.roomId });
      // On prévient le streamer : c'est lui qui va lancer la négociation WebRTC
      send(room.streamer, { type: "viewer-joined", viewerId });
      console.log(`[salon ${msg.roomId}] spectateur ${viewerId} arrivé (${room.viewers.size} au total)`);
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

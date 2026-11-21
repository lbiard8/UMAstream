// Serveur UMAstream : il sert les fichiers du site ET fait la "signalisation" WebRTC.
// Important : la vidéo ne passe JAMAIS par ici. Le serveur ne fait que mettre
// les navigateurs en relation, ensuite ils se parlent en direct (pair à pair).

import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { MAX_NAME_LENGTH, type ClientMessage, type ServerMessage, type ShareReach } from "../shared/messages.js";
import { getLanIp, startTunnel } from "./network.js";
import {
  ConnectionCounter,
  MAX_CONNECTIONS_PER_IP,
  MAX_CONNECTIONS_TOTAL,
  MAX_JOIN_REQUESTS_PER_MINUTE,
  MAX_PENDING_PER_ROOM,
  RateLimiter,
} from "./limits.js";
import {
  AttemptLimiter,
  hashPassword,
  IpCooldown,
  MAX_PASSWORD_LENGTH,
  verifyPassword,
  type PasswordHash,
} from "./password.js";

const PORT = Number(process.env.PORT ?? 3000);
// `npm run share` ajoute --tunnel : on crée alors une adresse publique via Cloudflare
// (l'application de bureau, elle, passe par la variable d'environnement UMASTREAM_TUNNEL=1)
const WANT_TUNNEL = process.argv.includes("--tunnel") || process.env.UMASTREAM_TUNNEL === "1";
// Lancé par l'application de bureau (Electron) : pas de process.exit(), on signale plutôt les erreurs
const EMBEDDED = process.env.UMASTREAM_EMBEDDED === "1";
// `--open` (ajouté par le lanceur UMAstream.cmd) : ouvrir la page dans le navigateur une fois prêt
const WANT_OPEN = process.argv.includes("--open");
const LOCAL_URL = `http://localhost:${PORT}`;

/** Ouvre une adresse dans le navigateur par défaut (Windows, macOS ou Linux). */
function openBrowser(url: string) {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]] // le "" est le titre de fenêtre attendu par "start"
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => console.log(`Ouvre ${url} dans ton navigateur.`));
  child.unref(); // le serveur ne garde pas de lien avec le navigateur
}

/** Adresse publique du tunnel, connue quelques secondes après le démarrage. */
let tunnelUrl: string | null = null;
const lanIp = await getLanIp();

/** Début du lien à partager : le plus "large" possible (internet > réseau local > ce PC). */
function shareInfo(): { shareBase?: string; reach: ShareReach } {
  if (tunnelUrl) return { shareBase: tunnelUrl, reach: "internet" };
  if (lanIp) return { shareBase: `http://${lanIp}:${PORT}`, reach: "lan" };
  return { reach: "local" };
}
// Dossier des fichiers du site. L'application de bureau indique le sien (il est dans l'appli installée).
const PUBLIC_DIR = process.env.UMASTREAM_PUBLIC_DIR
  ? join(process.env.UMASTREAM_PUBLIC_DIR, sep)
  : fileURLToPath(new URL("../public/", import.meta.url));

/** Résolu quand le serveur écoute (et que le tunnel est prêt ou a échoué). Utilisé par l'appli de bureau. */
let markReady!: (info: { port: number; tunnelUrl: string | null }) => void;
let markFailed!: (err: Error) => void;
export const serverReady = new Promise<{ port: number; tunnelUrl: string | null }>((resolve, reject) => {
  markReady = resolve;
  markFailed = reject;
});

// ---------------------------------------------------------------------------
// 1. Fichiers statiques (main-page.html, app.js, style.css)
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
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
  // Salle d'attente : bon mot de passe, mais pas encore accepté par le streamer
  pending: Map<string, { ws: WebSocket; name: string }>;
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
// Connexions ouvertes depuis ce PC : les SEULES autorisées à créer un salon (à streamer)
const localConnections = new WeakSet<WebSocket>();
const connectionsByIp = new ConnectionCounter();
const joinRateLimiter = new RateLimiter(MAX_JOIN_REQUESTS_PER_MINUTE, 60_000);
// Connexions dont une demande (création ou mot de passe) est en cours de traitement :
// on ignore leurs autres demandes, pour qu'on ne puisse pas tester 50 mots de passe en parallèle.
const busy = new WeakSet<WebSocket>();
const limiter = new AttemptLimiter();
// Après un refus du streamer, cette IP doit attendre 5 minutes avant de redemander
const refusedCooldown = new IpCooldown(5 * 60_000);
// Connexions en salle d'attente : dans quel salon, et sous quel id
const pendingOf = new Map<WebSocket, { roomId: string; viewerId: string }>();

/** Pseudo nettoyé : sans espaces autour, sans caractères invisibles, 20 caractères max. */
function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH);
}

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
  const cloudflareIp = req.headers["cf-connecting-ip"];
  if (isLoopback(socketIp) && typeof cloudflareIp === "string" && cloudflareIp) return cloudflareIp;
  return socketIp;
}

function isLoopback(ip: string | undefined): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/**
 * La connexion vient-elle vraiment de CE PC (page ouverte sur http://localhost) ?
 * - via le tunnel : la connexion arrive aussi de 127.0.0.1 (c'est cloudflared), MAIS avec l'en-tête
 *   "cf-connecting-ip" que Cloudflare ajoute toujours -> ce n'est pas ce PC ;
 * - depuis le réseau local : l'adresse n'est pas 127.0.0.1 -> ce n'est pas ce PC.
 */
function isFromThisPc(req: IncomingMessage): boolean {
  return isLoopback(req.socket.remoteAddress) && req.headers["cf-connecting-ip"] === undefined;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// maxPayload : taille max d'un message. Par défaut, la bibliothèque ws accepte jusqu'à 100 Mo,
// ce qui permettrait à n'importe qui de remplir la mémoire de ce PC avec quelques messages énormes.
// Nos plus gros messages (les offres WebRTC) font moins de 10 Ko : 64 Ko laisse une large marge.
// Au-delà, ws ferme la connexion tout seul (code 1009 "message trop gros").
const MAX_MESSAGE_BYTES = 64 * 1024;
const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

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
      // Seul le propriétaire de ce PC peut streamer : un inconnu qui a trouvé l'adresse du tunnel
      // ne peut pas créer de salons ici (ni faire calculer des hachages en boucle à ce PC).
      if (!localConnections.has(ws)) {
        console.warn(`Création de salon refusée : demande venue de l'extérieur (${ipOf.get(ws) ?? "?"})`);
        return send(ws, {
          type: "error",
          message: `Pour streamer, ouvre http://localhost:${PORT} sur le PC qui fait tourner UMAstream.`,
        });
      }
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
        rooms.set(roomId, { streamer: ws, viewers: new Map(), pending: new Map(), password });
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
      if (busy.has(ws) || pendingOf.has(ws)) return; // essai en cours, ou déjà en salle d'attente
      const ip = ipOf.get(ws) ?? "inconnue";
      // Compté AVANT de dire si le salon existe : on ne peut pas tester des numéros de salon en boucle
      if (!joinRateLimiter.tryConsume(ip)) {
        return send(ws, { type: "error", message: "Trop de tentatives, attends une minute." });
      }
      const room = rooms.get(msg.roomId);
      if (!room) return send(ws, { type: "error", message: "Ce salon n'existe pas (ou le stream est terminé)" });

      const blockedFor = limiter.blockedFor(ip);
      if (blockedFor > 0) {
        send(ws, { type: "blocked", reason: "attempts", retryAfterSeconds: blockedFor });
        ws.close();
        return;
      }
      const refusedFor = refusedCooldown.remainingSeconds(ip);
      if (refusedFor > 0) {
        send(ws, { type: "blocked", reason: "refused", retryAfterSeconds: refusedFor });
        ws.close();
        return;
      }
      // Premier contact (pas encore de mot de passe) : on demande le mot de passe, sans compter d'essai
      if (typeof msg.password !== "string" || msg.password.length === 0) {
        return send(ws, { type: "password-required" });
      }
      // Pseudo vérifié AVANT le mot de passe : un pseudo oublié ne doit pas coûter un essai
      const name = cleanName(msg.name);
      if (name.length === 0) return send(ws, { type: "error", message: "Choisis un pseudo" });

      busy.add(ws);
      try {
        await sleep(limiter.delayMs(ip)); // pause croissante après chaque erreur
        const ok = await verifyPassword(msg.password.slice(0, MAX_PASSWORD_LENGTH), room.password);
        if (ws.readyState !== WebSocket.OPEN) return;

        if (!ok) {
          const attemptsLeft = limiter.fail(ip);
          console.log(`[salon ${msg.roomId}] mot de passe faux depuis ${ip} (${attemptsLeft} essai(s) restant(s))`);
          if (attemptsLeft === 0) {
            send(ws, { type: "blocked", reason: "attempts", retryAfterSeconds: limiter.blockedFor(ip) });
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
        if (current.pending.size >= MAX_PENDING_PER_ROOM) {
          return send(ws, { type: "error", message: "Trop de demandes en attente, réessaie dans un moment." });
        }

        // Bon mot de passe : direction la salle d'attente. Le streamer décide (Accepter / Refuser).
        // Aucune connexion WebRTC tant qu'il n'a pas accepté : aucune IP échangée.
        const viewerId = newId();
        current.pending.set(viewerId, { ws, name });
        pendingOf.set(ws, { roomId: msg.roomId, viewerId });
        send(ws, { type: "waiting-approval" });
        send(current.streamer, { type: "join-request", viewerId, name });
        console.log(`[salon ${msg.roomId}] ${name} (${viewerId}) attend l'accord du streamer`);
      } finally {
        busy.delete(ws);
      }
      break;
    }

    case "join-answer": {
      // Seul le streamer du salon peut répondre, et seulement à une demande de SON salon
      if (me?.role !== "streamer") return;
      const room = rooms.get(me.roomId);
      const request = room?.pending.get(msg.viewerId);
      if (!room || !request) return; // demande annulée entre-temps (le spectateur est parti)
      room.pending.delete(msg.viewerId);
      pendingOf.delete(request.ws);

      if (!msg.accept) {
        const ip = ipOf.get(request.ws) ?? "inconnue";
        refusedCooldown.start(ip); // 5 min avant de pouvoir redemander
        send(request.ws, { type: "join-refused" });
        request.ws.close();
        console.log(`[salon ${me.roomId}] ${request.name} refusé`);
        return;
      }

      room.viewers.set(msg.viewerId, request.ws);
      peers.set(request.ws, { id: msg.viewerId, roomId: me.roomId, role: "viewer" });
      send(request.ws, { type: "joined", roomId: me.roomId });
      // C'est SEULEMENT maintenant que le streamer lance la connexion WebRTC
      send(ws, { type: "viewer-joined", viewerId: msg.viewerId, name: request.name });
      console.log(`[salon ${me.roomId}] ${request.name} accepté (${room.viewers.size} spectateur(s))`);
      break;
    }

    case "kick": {
      if (me?.role !== "streamer") return;
      const viewer = rooms.get(me.roomId)?.viewers.get(msg.viewerId);
      if (!viewer) return;
      send(viewer, { type: "kicked" });
      // La fermeture déclenche handleDisconnect, qui prévient le streamer (viewer-left)
      viewer.close();
      console.log(`[salon ${me.roomId}] spectateur ${msg.viewerId} expulsé`);
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
  // Spectateur parti pendant qu'il était en salle d'attente : on retire sa demande chez le streamer
  const waiting = pendingOf.get(ws);
  if (waiting) {
    pendingOf.delete(ws);
    const room = rooms.get(waiting.roomId);
    if (room?.pending.delete(waiting.viewerId)) {
      send(room.streamer, { type: "join-request-cancelled", viewerId: waiting.viewerId });
    }
    return;
  }

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
    for (const { ws: waitingWs } of room.pending.values()) {
      send(waitingWs, { type: "stream-ended" });
      pendingOf.delete(waitingWs);
    }
    rooms.delete(me.roomId);
    console.log(`[salon ${me.roomId}] fermé`);
  } else {
    room.viewers.delete(me.id);
    send(room.streamer, { type: "viewer-left", viewerId: me.id });
    console.log(`[salon ${me.roomId}] spectateur ${me.id} parti`);
  }
}

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

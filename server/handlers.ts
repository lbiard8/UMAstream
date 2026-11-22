// Ce que fait le serveur pour chaque message reçu : une fonction par type de message, dans une table
// (voir shared/dispatch.ts). Pour un nouveau message, on ajoute une entrée, sans toucher aux autres.

import { WebSocket } from "ws";
import { MAX_NAME_LENGTH, type ClientMessage, type ShareReach } from "../shared/messages.js";
import type { MessageHandlers } from "../shared/dispatch.js";
import { MAX_JOIN_REQUESTS_PER_MINUTE, MAX_PENDING_PER_ROOM, RateLimiter } from "./limits.js";
import { AttemptLimiter, hashPassword, IpCooldown, MAX_PASSWORD_LENGTH, verifyPassword } from "./password.js";
import type { RoomRegistry } from "./rooms.js";
import { send } from "./send.js";

/** Ce dont les gestionnaires ont besoin, fourni par le serveur. */
export interface HandlerDeps {
  rooms: RoomRegistry;
  /** Adresse IP réelle de la connexion. */
  ipOf(ws: WebSocket): string;
  /** La connexion vient-elle de CE PC (les seules autorisées à créer un salon) ? */
  isLocal(ws: WebSocket): boolean;
  /** Début du lien à partager, et qui pourra l'ouvrir. */
  shareInfo(): { shareBase?: string; reach: ShareReach };
  port: number;
}

/** Pseudo nettoyé : sans espaces autour, sans caractères invisibles, 20 caractères max. */
function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createHandlers({ rooms, ipOf, isLocal, shareInfo, port }: HandlerDeps): MessageHandlers<
  ClientMessage,
  [ws: WebSocket]
> {
  const joinRateLimiter = new RateLimiter(MAX_JOIN_REQUESTS_PER_MINUTE, 60_000);
  // Connexions dont une demande (création ou mot de passe) est en cours de traitement :
  // on ignore leurs autres demandes, pour qu'on ne puisse pas tester 50 mots de passe en parallèle.
  const busy = new WeakSet<WebSocket>();
  const limiter = new AttemptLimiter();
  // Après un refus du streamer, cette IP doit attendre 5 minutes avant de redemander
  const refusedCooldown = new IpCooldown(5 * 60_000);

  return {
    "create-room": async (msg, ws) => {
      if (rooms.peer(ws)) return send(ws, { type: "error", message: "Déjà dans un salon" });
      if (busy.has(ws)) return;
      // Seul le propriétaire de ce PC peut streamer : un inconnu qui a trouvé l'adresse du tunnel
      // ne peut pas créer de salons ici (ni faire calculer des hachages en boucle à ce PC).
      if (!isLocal(ws)) {
        console.warn(`Création de salon refusée : demande venue de l'extérieur (${ipOf(ws)})`);
        return send(ws, {
          type: "error",
          message: `Pour streamer, ouvre http://localhost:${port} sur le PC qui fait tourner UMAstream.`,
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
        const roomId = rooms.createRoom(ws, password);
        send(ws, { type: "room-created", roomId, ...shareInfo() });
        console.log(`[salon ${roomId}] créé`);
      } finally {
        busy.delete(ws);
      }
    },

    "join-room": async (msg, ws) => {
      if (rooms.peer(ws)) return send(ws, { type: "error", message: "Déjà dans un salon" });
      if (busy.has(ws) || rooms.isWaiting(ws)) return; // essai en cours, ou déjà en salle d'attente
      const ip = ipOf(ws);
      // Compté AVANT de dire si le salon existe : on ne peut pas tester des numéros de salon en boucle
      if (!joinRateLimiter.tryConsume(ip)) {
        return send(ws, { type: "error", message: "Trop de tentatives, attends une minute." });
      }
      const room = rooms.room(msg.roomId);
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
        const current = rooms.room(msg.roomId);
        if (!current) return send(ws, { type: "error", message: "Le stream vient de se terminer" });
        if (current.pending.size >= MAX_PENDING_PER_ROOM) {
          return send(ws, { type: "error", message: "Trop de demandes en attente, réessaie dans un moment." });
        }

        // Bon mot de passe : direction la salle d'attente. Le streamer décide (Accepter / Refuser).
        // Aucune connexion WebRTC tant qu'il n'a pas accepté : aucune IP échangée.
        const viewerId = rooms.addToWaitingRoom(msg.roomId, current, ws, name);
        send(ws, { type: "waiting-approval" });
        send(current.streamer, { type: "join-request", viewerId, name });
        console.log(`[salon ${msg.roomId}] ${name} (${viewerId}) attend l'accord du streamer`);
      } finally {
        busy.delete(ws);
      }
    },

    "join-answer": (msg, ws) => {
      // Seul le streamer du salon peut répondre, et seulement à une demande de SON salon
      const me = rooms.peer(ws);
      if (me?.role !== "streamer") return;
      const room = rooms.room(me.roomId);
      const request = room && rooms.takeRequest(room, msg.viewerId);
      if (!room || !request) return; // demande annulée entre-temps (le spectateur est parti)

      if (!msg.accept) {
        refusedCooldown.start(ipOf(request.ws)); // 5 min avant de pouvoir redemander
        send(request.ws, { type: "join-refused" });
        request.ws.close();
        console.log(`[salon ${me.roomId}] ${request.name} refusé`);
        return;
      }

      const resumeToken = rooms.acceptViewer(me.roomId, room, msg.viewerId, request.ws);
      send(request.ws, { type: "joined", roomId: me.roomId, resumeToken });
      // C'est SEULEMENT maintenant que le streamer lance la connexion WebRTC
      send(ws, { type: "viewer-joined", viewerId: msg.viewerId, name: request.name });
      console.log(`[salon ${me.roomId}] ${request.name} accepté (${room.viewers.size} spectateur(s))`);
    },

    resume: (msg, ws) => {
      // Spectateur déjà accepté qui revient après une coupure de sa connexion au serveur
      if (rooms.peer(ws) || rooms.isWaiting(ws)) return;
      if (!joinRateLimiter.tryConsume(ipOf(ws))) {
        return send(ws, { type: "error", message: "Trop de tentatives, attends une minute." });
      }
      const viewerId = rooms.resumeViewer(msg.roomId, msg.resumeToken, ws);
      if (!viewerId) return send(ws, { type: "resume-failed" }); // trop tard, ou stream terminé
      send(ws, { type: "resumed" });
      console.log(`[salon ${msg.roomId}] spectateur ${viewerId} reconnecté`);
    },

    kick: (msg, ws) => {
      const me = rooms.peer(ws);
      if (me?.role !== "streamer") return;
      const room = rooms.room(me.roomId);
      const viewer = room?.viewers.get(msg.viewerId);
      if (!room || !viewer) return;
      send(viewer, { type: "kicked" });
      rooms.kickViewer(me.roomId, room, msg.viewerId, viewer);
      viewer.close();
      console.log(`[salon ${me.roomId}] spectateur ${msg.viewerId} expulsé`);
    },

    signal: (msg, ws) => {
      const me = rooms.peer(ws);
      if (!me) return;
      const room = rooms.room(me.roomId);
      if (!room) return;
      // Un spectateur ne peut parler qu'au streamer, le streamer à ses spectateurs.
      const target = me.role === "viewer" ? room.streamer : room.viewers.get(msg.to);
      if (target) send(target, { type: "signal", from: me.id, data: msg.data });
    },
  };
}

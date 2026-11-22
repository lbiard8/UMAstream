// Les salons et qui est dedans : le streamer, la salle d'attente, les spectateurs acceptés, leurs
// jetons de reprise et leur période de grâce. Toutes les règles « qui est où » sont ICI, et seulement ici.

import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";
import { RESUME_GRACE_SECONDS } from "../shared/messages.js";
import type { PasswordHash } from "./password.js";
import { send } from "./send.js";

export interface Room {
  streamer: WebSocket;
  viewers: Map<string, WebSocket>; // viewerId -> connexion
  // Salle d'attente : bon mot de passe, mais pas encore accepté par le streamer
  pending: Map<string, { ws: WebSocket; name: string }>;
  password: PasswordHash; // empreinte du mot de passe, jamais le mot de passe en clair
  // Jetons de reprise : jeton secret -> viewerId (donné au spectateur quand il est accepté)
  resumeTokens: Map<string, string>;
  // Spectateurs déconnectés qu'on garde le temps qu'ils se reconnectent : viewerId -> minuteur
  graceTimers: Map<string, NodeJS.Timeout>;
}

/** Ce qu'on sait de chaque connexion entrée dans un salon. */
export interface PeerInfo {
  id: string;
  roomId: string;
  role: "streamer" | "viewer";
}

export const newId = () => randomBytes(4).toString("hex"); // ex : "9f3a1c07"

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly peers = new Map<WebSocket, PeerInfo>();
  // Connexions en salle d'attente : dans quel salon, et sous quel id
  private readonly pendingOf = new Map<WebSocket, { roomId: string; viewerId: string }>();

  room(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** Le salon et le rôle de cette connexion (undefined si elle n'est dans aucun salon). */
  peer(ws: WebSocket): PeerInfo | undefined {
    return this.peers.get(ws);
  }

  isWaiting(ws: WebSocket): boolean {
    return this.pendingOf.has(ws);
  }

  createRoom(streamer: WebSocket, password: PasswordHash): string {
    const roomId = newId();
    this.rooms.set(roomId, {
      streamer,
      viewers: new Map(),
      pending: new Map(),
      password,
      resumeTokens: new Map(),
      graceTimers: new Map(),
    });
    this.peers.set(streamer, { id: "streamer", roomId, role: "streamer" });
    return roomId;
  }

  /** Bon mot de passe : direction la salle d'attente. Renvoie l'id donné au spectateur. */
  addToWaitingRoom(roomId: string, room: Room, ws: WebSocket, name: string): string {
    const viewerId = newId();
    room.pending.set(viewerId, { ws, name });
    this.pendingOf.set(ws, { roomId, viewerId });
    return viewerId;
  }

  /** Retire une demande de la salle d'attente (le streamer y a répondu) et la renvoie. */
  takeRequest(room: Room, viewerId: string) {
    const request = room.pending.get(viewerId);
    if (!request) return undefined;
    room.pending.delete(viewerId);
    this.pendingOf.delete(request.ws);
    return request;
  }

  /** Le streamer a accepté : le spectateur entre. Renvoie son jeton de reprise. */
  acceptViewer(roomId: string, room: Room, viewerId: string, ws: WebSocket): string {
    room.viewers.set(viewerId, ws);
    this.peers.set(ws, { id: viewerId, roomId, role: "viewer" });
    // Jeton secret (128 bits, impossible à deviner) : il permettra au spectateur de se reconnecter
    // si sa connexion au serveur se coupe, sans retaper le mot de passe ni repasser par l'attente
    const resumeToken = randomBytes(16).toString("hex");
    room.resumeTokens.set(resumeToken, viewerId);
    return resumeToken;
  }

  /**
   * Spectateur déjà accepté qui revient avec son jeton : sa nouvelle connexion remplace l'ancienne.
   * Renvoie son id, ou undefined si le jeton n'est pas (ou plus) valable.
   */
  resumeViewer(roomId: string, resumeToken: unknown, ws: WebSocket): string | undefined {
    const room = this.rooms.get(roomId);
    const viewerId = typeof resumeToken === "string" ? room?.resumeTokens.get(resumeToken) : undefined;
    if (!room || !viewerId) return undefined;

    // Il retrouve sa place : on annule son départ programmé
    clearTimeout(room.graceTimers.get(viewerId));
    room.graceTimers.delete(viewerId);
    const old = room.viewers.get(viewerId);
    room.viewers.set(viewerId, ws);
    this.peers.set(ws, { id: viewerId, roomId, role: "viewer" });
    if (old && old !== ws) {
      this.peers.delete(old); // sa fermeture ne doit plus rien déclencher
      old.terminate();
    }
    return viewerId;
  }

  /** Expulsion immédiate et définitive : pas de période de grâce, et son jeton de reprise est annulé. */
  kickViewer(roomId: string, room: Room, viewerId: string, ws: WebSocket) {
    this.peers.delete(ws);
    this.removeViewer(room, roomId, viewerId);
  }

  /** Une connexion s'est fermée. */
  disconnect(ws: WebSocket) {
    // Spectateur parti pendant qu'il était en salle d'attente : on retire sa demande chez le streamer
    const waiting = this.pendingOf.get(ws);
    if (waiting) {
      this.pendingOf.delete(ws);
      const room = this.rooms.get(waiting.roomId);
      if (room?.pending.delete(waiting.viewerId)) {
        send(room.streamer, { type: "join-request-cancelled", viewerId: waiting.viewerId });
      }
      return;
    }

    const me = this.peers.get(ws);
    if (!me) return;
    this.peers.delete(ws);
    const room = this.rooms.get(me.roomId);
    if (!room) return;

    if (me.role === "streamer") this.closeRoom(me.roomId, room);
    else this.startGracePeriod(me.roomId, room, me.id, ws);
  }

  /** Le streamer part : on ferme le salon et on prévient tout le monde. */
  private closeRoom(roomId: string, room: Room) {
    for (const viewer of room.viewers.values()) {
      send(viewer, { type: "stream-ended" });
      this.peers.delete(viewer);
    }
    for (const { ws: waitingWs } of room.pending.values()) {
      send(waitingWs, { type: "stream-ended" });
      this.pendingOf.delete(waitingWs);
    }
    for (const timer of room.graceTimers.values()) clearTimeout(timer);
    this.rooms.delete(roomId);
    console.log(`[salon ${roomId}] fermé`);
  }

  /**
   * La connexion d'un spectateur au SERVEUR s'est coupée, mais sa vidéo (en direct avec le streamer)
   * passe peut-être encore : on le garde 30 s, le temps qu'il se reconnecte tout seul avec son jeton.
   */
  private startGracePeriod(roomId: string, room: Room, viewerId: string, ws: WebSocket) {
    // Une nouvelle connexion l'a déjà remplacé (il s'est reconnecté) : rien à faire
    if (room.viewers.get(viewerId) !== ws) return;
    room.graceTimers.set(
      viewerId,
      setTimeout(() => {
        this.removeViewer(room, roomId, viewerId);
        console.log(`[salon ${roomId}] spectateur ${viewerId} parti (pas revenu en ${RESUME_GRACE_SECONDS} s)`);
      }, RESUME_GRACE_SECONDS * 1000),
    );
    console.log(`[salon ${roomId}] spectateur ${viewerId} déconnecté : on l'attend ${RESUME_GRACE_SECONDS} s`);
  }

  /** Retire définitivement un spectateur du salon, et prévient le streamer. */
  private removeViewer(room: Room, roomId: string, viewerId: string) {
    clearTimeout(room.graceTimers.get(viewerId));
    room.graceTimers.delete(viewerId);
    if (!room.viewers.delete(viewerId)) return; // déjà retiré
    for (const [token, id] of room.resumeTokens) if (id === viewerId) room.resumeTokens.delete(token);
    if (this.rooms.get(roomId) === room) send(room.streamer, { type: "viewer-left", viewerId });
  }
}

// Types des messages échangés en WebSocket entre les navigateurs et le serveur.
// Ce fichier est importé à la fois par le client et par le serveur : si on change
// un message d'un côté, TypeScript signale tout de suite ce qui casse de l'autre.

/** Qualité demandée par un spectateur. "max" = celle choisie par le streamer. */
export type ViewerQuality = "max" | "1080p" | "720p" | "480p" | "360p";

/** Données échangées entre streamer et spectateur, que le serveur fait suivre sans les lire. */
export type SignalData =
  | { kind: "offer" | "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit }
  // Spectateur -> streamer : "envoie-moi cette qualité" (ne concerne que SA connexion)
  | { kind: "quality"; preset: ViewerQuality };

/** Qui pourra ouvrir le lien : n'importe qui, le réseau local seulement, ou ce PC seulement. */
export type ShareReach = "internet" | "lan" | "local";

/** Messages envoyés par un navigateur au serveur. */
export type ClientMessage =
  | { type: "create-room" }
  | { type: "join-room"; roomId: string }
  // `to` = id du spectateur (si on est le streamer) ou "streamer" (si on est spectateur)
  | { type: "signal"; to: string; data: SignalData };

/** Messages envoyés par le serveur à un navigateur. */
export type ServerMessage =
  // shareBase = début du lien à partager (tunnel internet, ou IP locale) ; absent = on garde l'adresse actuelle
  | { type: "room-created"; roomId: string; shareBase?: string; reach: ShareReach }
  | { type: "joined"; roomId: string }
  | { type: "viewer-joined"; viewerId: string }
  | { type: "viewer-left"; viewerId: string }
  | { type: "signal"; from: string; data: SignalData }
  | { type: "stream-ended" }
  | { type: "error"; message: string };

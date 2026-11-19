// Types des messages échangés en WebSocket entre les navigateurs et le serveur.
// Ce fichier est importé à la fois par le client et par le serveur : si on change
// un message d'un côté, TypeScript signale tout de suite ce qui casse de l'autre.

/** Données WebRTC que le serveur fait suivre sans les lire. */
export type SignalData =
  | { kind: "offer" | "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

/** Messages envoyés par un navigateur au serveur. */
export type ClientMessage =
  | { type: "create-room" }
  | { type: "join-room"; roomId: string }
  // `to` = id du spectateur (si on est le streamer) ou "streamer" (si on est spectateur)
  | { type: "signal"; to: string; data: SignalData };

/** Messages envoyés par le serveur à un navigateur. */
export type ServerMessage =
  | { type: "room-created"; roomId: string }
  | { type: "joined"; roomId: string }
  | { type: "viewer-joined"; viewerId: string }
  | { type: "viewer-left"; viewerId: string }
  | { type: "signal"; from: string; data: SignalData }
  | { type: "stream-ended" }
  | { type: "error"; message: string };

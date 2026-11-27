// Types des messages échangés en WebSocket entre les navigateurs et le serveur.
// Ce fichier est importé à la fois par le client et par le serveur : si on change
// un message d'un côté, TypeScript signale tout de suite ce qui casse de l'autre.

/** Qualité demandée par un spectateur. "max" = celle choisie par le streamer. */
export type ViewerQuality = "max" | "1080p" | "720p" | "480p" | "360p";

/** Longueur max d'un pseudo de spectateur. */
export const MAX_NAME_LENGTH = 20;

/** Données échangées entre streamer et spectateur, que le serveur fait suivre sans les lire. */
export type SignalData =
  | { kind: "offer" | "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit }
  // Spectateur -> streamer : "envoie-moi cette qualité" (ne concerne que SA connexion)
  | { kind: "quality"; preset: ViewerQuality }
  // Streamer -> spectateur : le stream est en pause (ou reprend). La connexion, elle, reste ouverte.
  | { kind: "pause"; paused: boolean }
  // Streamer -> UN spectateur : il ne reçoit plus ni image ni son (ou les retrouve)
  | { kind: "blind"; blinded: boolean }
  // Spectateur -> streamer : ma connexion vidéo a décroché, relance-la (ICE restart)
  | { kind: "restart-ice" };

/** Durée pendant laquelle le serveur garde un spectateur déconnecté, le temps qu'il se reconnecte. */
export const RESUME_GRACE_SECONDS = 30;

/** Qui pourra ouvrir le lien : n'importe qui, le réseau local seulement, ou ce PC seulement. */
export type ShareReach = "internet" | "lan" | "local";

/** Messages envoyés par un navigateur au serveur. */
export type ClientMessage =
  // Le mot de passe est obligatoire pour créer un salon
  | { type: "create-room"; password: string }
  // Sans mot de passe, le serveur répond "password-required" (premier contact du spectateur).
  // Avec le mot de passe, le pseudo est obligatoire : c'est lui que le streamer verra.
  | { type: "join-room"; roomId: string; password?: string; name?: string }
  // Streamer -> serveur : réponse à une demande d'entrée (viewerId = celui de la demande)
  | { type: "join-answer"; viewerId: string; accept: boolean }
  // Streamer -> serveur : expulser un spectateur
  | { type: "kick"; viewerId: string }
  // Spectateur déjà accepté dont la connexion au serveur s'est coupée : il revient avec son jeton
  // secret, sans retaper le mot de passe ni repasser par la salle d'attente
  | { type: "resume"; roomId: string; resumeToken: string }
  // `to` = id du spectateur (si on est le streamer) ou "streamer" (si on est spectateur)
  | { type: "signal"; to: string; data: SignalData };

/**
 * Pourquoi un spectateur est bloqué :
 *  - "attempts" : 5 mauvais mots de passe
 *  - "refused"  : le streamer a refusé sa demande récemment
 */
export type BlockReason = "attempts" | "refused";

/** Messages envoyés par le serveur à un navigateur. */
export type ServerMessage =
  // shareBase = début du lien à partager (tunnel internet, ou IP locale) ; absent = on garde l'adresse actuelle
  | { type: "room-created"; roomId: string; shareBase?: string; reach: ShareReach }
  // resumeToken : jeton secret pour se reconnecter si la connexion au serveur se coupe (voir "resume")
  | { type: "joined"; roomId: string; resumeToken: string }
  | { type: "resumed" } // reconnexion réussie : on retrouve sa place, la vidéo continue
  | { type: "resume-failed" } // trop tard (plus de 30 s) ou stream terminé : il faut rejoindre à nouveau
  // Réponses à un spectateur qui veut entrer. Tant qu'il n'est pas accepté,
  // aucune connexion WebRTC n'est lancée : aucune IP n'est échangée.
  | { type: "password-required" }
  | { type: "password-wrong"; attemptsLeft: number }
  | { type: "blocked"; reason: BlockReason; retryAfterSeconds: number }
  | { type: "waiting-approval" } // bon mot de passe, on attend l'accord du streamer
  | { type: "join-refused" }
  | { type: "kicked" }
  // Serveur -> streamer : gestion des spectateurs
  | { type: "join-request"; viewerId: string; name: string }
  | { type: "join-request-cancelled"; viewerId: string } // il a fermé la page pendant l'attente
  | { type: "viewer-joined"; viewerId: string; name: string }
  | { type: "viewer-left"; viewerId: string }
  | { type: "signal"; from: string; data: SignalData }
  | { type: "stream-ended" }
  // Spectateur : ce salon n'existe pas (lien faux, ou stream terminé avant son arrivée)
  | { type: "room-not-found" }
  | { type: "error"; message: string };

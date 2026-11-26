// Connexion WebSocket avec le serveur de signalisation (« mettre les navigateurs en relation »).
//
// Le streamer et le spectateur ne créent pas eux-mêmes leur WebSocket : ils reçoivent ce
// SignalingClient et ne connaissent que ses méthodes (send, close…). Principe « D » de SOLID :
// le code du stream dépend d'un service de messages, pas du détail du WebSocket.

import type { ClientMessage, ServerMessage } from "../../shared/messages.js";
import { dispatch, type MessageHandlers } from "../../shared/dispatch.js";

export type ServerMessageHandlers = MessageHandlers<ServerMessage>;

/** Ce qu'a besoin de savoir le reste du code pour envoyer un message. */
export type SendMessage = (msg: ClientMessage) => void;

export interface SignalingOptions {
  /** Un gestionnaire par type de message reçu. */
  handlers: ServerMessageHandlers;
  /** Appelé à chaque connexion réussie (la première, et après chaque reconnexion). */
  onOpen: () => void;
  /** Appelé quand la connexion se coupe (sauf après close() ou stopReconnecting()). */
  onLost?: () => void;
  /** Se reconnecter tout seul après une coupure ? */
  reconnect: boolean;
}

export class SignalingClient {
  private ws!: WebSocket;
  // Les handlers WebRTC sont asynchrones. Sans cette file d'attente, un candidat ICE
  // pourrait être traité avant que l'offre soit appliquée -> erreur.
  private queue = Promise.resolve();
  private reconnectAttempts = 0;
  private stopped = false;

  constructor(private readonly options: SignalingOptions) {
    this.open();
  }

  /** Envoie un message (ignoré si la connexion n'est pas ouverte, par exemple pendant une reconnexion). */
  readonly send: SendMessage = (msg) => {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  };

  /** Plus de reconnexion automatique (expulsé, refusé, bloqué, stream terminé : ne pas revenir). */
  stopReconnecting() {
    this.stopped = true;
  }

  /** Ferme la connexion pour de bon. */
  close() {
    this.stopped = true;
    this.ws.close();
  }

  private open() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${location.host}`);
    this.ws = ws;

    // Les messages sont traités UN PAR UN, dans l'ordre d'arrivée
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      this.queue = this.queue.then(() => dispatch(this.options.handlers, msg)).then(
        () => {},
        (err) => console.error(err),
      );
    });

    ws.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      this.options.onOpen();
    });

    ws.addEventListener("close", () => {
      if (this.stopped) return;
      this.options.onLost?.();
      if (!this.options.reconnect) return;
      // 1 s, 2 s, 4 s, puis toutes les 5 s : assez vite pour rester dans les 30 s de grâce du serveur
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 5000);
      this.reconnectAttempts++;
      setTimeout(() => this.open(), delay);
    });
  }
}

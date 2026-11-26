import { WebSocket } from "ws";
import type { ServerMessage } from "../shared/messages.js";

/** Envoie un message à un navigateur (ignoré si sa connexion n'est plus ouverte). */
export function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// Salle d'attente du streamer : les spectateurs qui ont tapé le bon mot de passe et attendent son accord.
// Tant qu'ils ne sont pas acceptés, aucune connexion WebRTC : leur IP et celle du streamer restent cachées.

import type { SendMessage } from "../core/signaling.js";

export class WaitingRoom {
  private readonly pending = new Map<string, string>(); // viewerId -> pseudo

  /** Appelé quand la liste d'attente change (pour mettre la page à jour). */
  onChange: () => void = () => {};

  constructor(
    private readonly send: SendMessage,
    /** Case « Accepter automatiquement » : décochée par défaut. */
    private readonly autoAccept: () => boolean,
  ) {}

  list(): [id: string, name: string][] {
    return [...this.pending];
  }

  /** Quelqu'un demande à entrer. */
  request(viewerId: string, name: string) {
    if (this.autoAccept()) {
      this.send({ type: "join-answer", viewerId, accept: true });
    } else {
      this.pending.set(viewerId, name);
      this.onChange();
    }
  }

  /** Il a fermé la page pendant l'attente. */
  cancel(viewerId: string) {
    this.pending.delete(viewerId);
    this.onChange();
  }

  /** Le streamer accepte ou refuse. */
  answer(viewerId: string, accept: boolean) {
    this.pending.delete(viewerId);
    this.send({ type: "join-answer", viewerId, accept });
    this.onChange();
  }

  /** On vient de cocher « Accepter automatiquement » : on accepte aussi ceux qui attendent déjà. */
  acceptAll() {
    for (const id of [...this.pending.keys()]) this.answer(id, true);
  }
}

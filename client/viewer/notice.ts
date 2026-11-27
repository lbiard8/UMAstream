// Carte « impasse » du spectateur (salon introuvable, stream terminé) : au lieu d'une simple ligne
// rouge, on explique ce qui se passe et quoi faire, avec un bouton « Réessayer ».

import { $, setStatus } from "../core/dom.js";

export class Notice {
  constructor() {
    // Réessayer = recharger la page : on repart de zéro (le streamer a peut-être relancé son stream)
    $("retry-btn").addEventListener("click", () => location.reload());
  }

  show(title: string, text: string) {
    $("viewer-notice-title").textContent = title;
    $("viewer-notice-text").textContent = text;
    $("viewer-notice").hidden = false;
    setStatus("");
  }

  hide() {
    $("viewer-notice").hidden = true;
  }
}

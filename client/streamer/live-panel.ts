// Panneau « En direct » du streamer : le lien à partager, à qui il est accessible, l'état pause / direct.

import type { ShareReach } from "../../shared/messages.js";
import { $ } from "../core/dom.js";
import { setIconText, type IconName } from "../core/icons.js";

// Explication affichée sous le lien, selon qui pourra l'ouvrir.
// Record<ShareReach, string> : TypeScript exige un texte pour CHAQUE cas possible.
const REACH_NOTE: Record<ShareReach, [IconName, string]> = {
  internet: ["globe", "Lien accessible depuis n'importe où."],
  lan: ["home", "Lien valable seulement sur ton réseau (même box / Wi-Fi). Pour un lien internet : installe cloudflared puis lance npm run share"],
  local: ["laptop", "Lien valable seulement sur ce PC. Pour un lien internet : installe cloudflared puis lance npm run share"],
};

/** Salon créé : on affiche le lien et on passe la page en mode « en direct » (2 colonnes). */
export function showRoom(roomId: string, reach: ShareReach, shareBase?: string) {
  // Le serveur connaît une adresse joignable par les autres PC (tunnel ou IP locale).
  // location.origin vaudrait "http://localhost:3000", qui ne marche que sur CE PC.
  const base = shareBase ?? location.origin;
  $<HTMLInputElement>("share-link").value = `${base}/?room=${roomId}`;
  setIconText($("reach-note"), ...REACH_NOTE[reach]);
  $("reach-note").dataset.reach = reach;
  // En pair à pair, chaque spectateur reçoit l'IP du streamer (candidats ICE).
  // Inutile de prévenir si le lien ne sort pas de ce PC.
  $("privacy-note").hidden = reach === "local";
  $("live-panel").hidden = false;
  $("people-panel").hidden = false;
  $("streamer-view").classList.add("is-live");
}

/** Affiche l'état pause / direct (bouton, étiquette, couleur du panneau). */
export function showPaused(paused: boolean) {
  setIconText($("pause-btn"), paused ? "play" : "pause", paused ? "Reprendre" : "Pause");
  $("live-label").textContent = paused ? "En pause" : "En direct";
  $("live-panel").classList.toggle("is-paused", paused);
}

/** Bouton « Copier le lien ». */
export function setupCopyButton() {
  $("copy-btn").addEventListener("click", async () => {
    await navigator.clipboard.writeText($<HTMLInputElement>("share-link").value);
    $("copy-btn").textContent = "Copié !";
    setTimeout(() => ($("copy-btn").textContent = "Copier le lien"), 1500);
  });
}

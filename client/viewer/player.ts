// Lecteur du spectateur : la vidéo, le son, le plein écran et le bandeau pause / aveugle.

import { $ } from "../core/dom.js";

export class Player {
  private readonly video = $<HTMLVideoElement>("remote");
  private paused = false;
  private blinded = false;

  constructor() {
    $("unmute-btn").addEventListener("click", () => {
      this.video.muted = !this.video.muted;
      this.syncMuteButton();
    });
    // Plein écran sur le bloc vidéo + stats (et non la seule <video>), pour garder les stats visibles
    $("fullscreen-btn").addEventListener("click", () => $("video-wrap").requestFullscreen());
  }

  show() {
    $("player").hidden = false;
  }

  /** Plus de vidéo (expulsé, reconnexion trop tardive) : on vide et on cache le lecteur. */
  hide() {
    this.clear();
    $("player").hidden = true;
  }

  /** Stream terminé : on vide la vidéo. */
  clear() {
    this.video.srcObject = null;
  }

  /** Affiche le flux reçu (l'image et le son arrivent dans le même flux : une seule fois suffit). */
  attach(stream: MediaStream) {
    if (this.video.srcObject === stream) return;
    this.video.srcObject = stream;
    void this.playWithSound();
  }

  /** Le streamer a mis en pause : la dernière image reste figée, on affiche juste le bandeau. */
  setPaused(paused: boolean) {
    this.paused = paused;
    this.updateBanner();
  }

  /** Le streamer ne nous envoie plus ni image ni son (à nous seulement). */
  setBlinded(blinded: boolean) {
    this.blinded = blinded;
    this.updateBanner();
  }

  // Bandeau par-dessus la vidéo : "aveugle" passe avant "pause" (c'est ce qui le concerne lui)
  private updateBanner() {
    const banner = $("video-banner");
    banner.hidden = !this.paused && !this.blinded;
    banner.textContent = this.blinded ? "🙈 Le streamer a masqué l'image pour toi" : "⏸ Stream en pause";
  }

  // Le son est activé dès l'arrivée du stream. Les navigateurs refusent normalement la lecture AVEC
  // son tant que la personne n'a pas interagi avec la page… mais le spectateur a déjà cliqué sur
  // « Rejoindre » (ou appuyé sur Entrée) : ce geste suffit pour que le navigateur l'autorise.
  private async playWithSound() {
    this.video.muted = false;
    try {
      await this.video.play();
    } catch {
      // Refusé quand même (navigateur strict) : on lance l'image en muet, le bouton activera le son
      this.video.muted = true;
      await this.video.play().catch(() => {});
    }
    this.syncMuteButton();
  }

  private syncMuteButton() {
    $("unmute-btn").textContent = this.video.muted ? "🔊 Activer le son" : "🔇 Couper le son";
  }
}

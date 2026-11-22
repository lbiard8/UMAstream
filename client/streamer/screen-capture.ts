// Capture de l'écran du streamer : la démarrer, changer d'écran, changer la qualité en direct.
//
// D'où vient l'image dépend de la version :
//  - navigateur : la fenêtre de choix de Chrome, avec le son du PC ;
//  - appli de bureau : notre propre fenêtre de choix, et le son du mélangeur (par application).
// Les deux sont des « CaptureSource » interchangeables (principes « O » et « L » de SOLID) :
// ScreenCapture fonctionne avec n'importe laquelle sans savoir laquelle c'est.

import type { ScreenSourceApi } from "../../shared/app-bridge.js";
import { ShareError } from "../core/errors.js";
import type { StreamQuality } from "../core/quality.js";
import { pickScreenSource } from "../desktop/screen-picker.js";

/** Une façon d'obtenir l'image (et le son) à partager. */
export interface CaptureSource {
  /** Ouvre une fenêtre de choix d'écran et renvoie la capture (erreur si annulé). */
  capture(quality: StreamQuality): Promise<MediaStream>;
}

/** Demande la capture au navigateur, avec les bons indices pour l'encodeur. */
async function displayMedia(quality: StreamQuality, withAudio: boolean): Promise<MediaStream> {
  const captured = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: quality.width && { ideal: quality.width },
      height: quality.height && { ideal: quality.height },
      frameRate: { ideal: quality.fps },
    },
    audio: withAudio,
  });
  // Indice pour l'encodeur : "motion" = garder les fps, "detail" = garder la netteté
  captured.getVideoTracks()[0]!.contentHint = quality.hint;
  return captured;
}

/** Indice pour l'encodeur Opus : musique / son de jeu, pas une voix. */
function markAsMusic(stream: MediaStream) {
  for (const track of stream.getAudioTracks()) track.contentHint = "music";
}

/** Version navigateur : la fenêtre de choix de Chrome, et le son du PC (écran entier ou onglet). */
export const browserCaptureSource: CaptureSource = {
  async capture(quality) {
    const captured = await displayMedia(quality, true);
    markAsMusic(captured);
    return captured;
  },
};

/**
 * Appli de bureau : notre propre fenêtre de choix (Electron n'a pas celle de Chrome),
 * et le son vient du mélangeur (par application) au lieu du son du PC.
 */
export function desktopCaptureSource(
  app: ScreenSourceApi,
  mixerTrack: () => MediaStreamTrack | null,
): CaptureSource {
  return {
    async capture(quality) {
      const sourceId = await pickScreenSource(app);
      if (!sourceId) throw new Error("Partage annulé");
      try {
        await app.selectScreenSource(sourceId); // rouvre d'abord une fenêtre réduite
      } catch (err) {
        // Message utile (ex. fenêtre impossible à rouvrir) plutôt qu'un simple "annulé"
        throw new ShareError(
          err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err),
        );
      }
      const captured = await displayMedia(quality, false);
      // Une COPIE de la piste du mélangeur : arrêter l'ancienne capture (changer d'écran, arrêter)
      // n'arrête que la copie, le mélangeur continue.
      const track = mixerTrack();
      if (track) captured.addTrack(track.clone());
      markAsMusic(captured);
      return captured;
    },
  };
}

/** La capture en cours. L'image et le son sont remplacés quand on change d'écran. */
export class ScreenCapture {
  private constructor(
    private readonly source: CaptureSource,
    private stream: MediaStream,
    /** Appelé quand le partage s'arrête de l'extérieur (bouton « Arrêter le partage » du navigateur). */
    private readonly onEnded: () => void,
  ) {
    this.videoTrack.addEventListener("ended", this.onEnded);
  }

  /** Ouvre la fenêtre de choix d'écran et démarre la capture (erreur si annulé). */
  static async start(source: CaptureSource, quality: StreamQuality, onEnded: () => void): Promise<ScreenCapture> {
    return new ScreenCapture(source, await source.capture(quality), onEnded);
  }

  get mediaStream(): MediaStream {
    return this.stream;
  }
  get videoTrack(): MediaStreamTrack {
    return this.stream.getVideoTracks()[0]!;
  }
  get audioTrack(): MediaStreamTrack | null {
    return this.stream.getAudioTracks()[0] ?? null;
  }

  /**
   * Changer d'écran sans couper le stream. Rouvre la fenêtre de choix (erreur si annulé : l'écran
   * actuel continue), puis appelle `useNewTracks` pour que les spectateurs reçoivent le nouvel écran,
   * et seulement ENSUITE arrête l'ancien.
   */
  async switchSource(quality: StreamQuality, useNewTracks: () => Promise<void>) {
    const newStream = await this.source.capture(quality);
    const oldStream = this.stream;
    const oldVideoTrack = this.videoTrack;
    this.stream = newStream;
    await useNewTracks();
    // PIÈGE : l'ancienne piste déclenchait onEnded à sa fin. On détache l'écouteur AVANT de l'arrêter,
    // sinon changer d'écran couperait tout le stream.
    oldVideoTrack.removeEventListener("ended", this.onEnded);
    oldStream.getTracks().forEach((t) => t.stop());
    this.videoTrack.addEventListener("ended", this.onEnded);
  }

  /**
   * Changer la résolution / les fps en direct, sans rouvrir la fenêtre de choix d'écran.
   * applyConstraints() redimensionne la capture en cours : même écran, spectateurs toujours connectés.
   */
  async applyQuality(quality: StreamQuality) {
    const track = this.videoTrack;
    // "Native" : on redemande la taille maximale de l'écran partagé (sinon la capture resterait réduite)
    const caps = track.getCapabilities();
    const width = quality.width ?? caps.width?.max;
    const height = quality.height ?? caps.height?.max;
    await track.applyConstraints({
      width: width && { ideal: width },
      height: height && { ideal: height },
      frameRate: { ideal: quality.fps },
    });
  }

  stop() {
    this.stream.getTracks().forEach((t) => t.stop());
  }
}

// Menus Résolution / Fps du streamer : ils reprennent le dernier choix et donnent la qualité choisie.

import { loadPref, savePref } from "../core/prefs.js";
import { isFps, isResolutionKey, streamQuality, type StreamQuality } from "../core/quality.js";

export class QualityMenus {
  constructor(
    private readonly resolution: HTMLSelectElement,
    private readonly fps: HTMLSelectElement,
  ) {
    // Les menus reprennent le dernier choix (sinon 1080p / 60, sélectionnés dans le HTML).
    // On vérifie la valeur retenue : une ancienne valeur ou une valeur bricolée est ignorée.
    const storedResolution = loadPref("streamResolution");
    if (storedResolution && isResolutionKey(storedResolution)) resolution.value = storedResolution;
    const storedFps = Number(loadPref("streamFps"));
    if (isFps(storedFps)) fps.value = String(storedFps);

    resolution.addEventListener("change", () => savePref("streamResolution", resolution.value));
    fps.addEventListener("change", () => savePref("streamFps", fps.value));
  }

  /** Qualité correspondant à ce qui est sélectionné dans les deux menus. */
  selected(): StreamQuality {
    const resolution = isResolutionKey(this.resolution.value) ? this.resolution.value : "1080";
    const fps = Number(this.fps.value);
    return streamQuality(resolution, isFps(fps) ? fps : 60);
  }

  /** Texte de la résolution choisie, tel qu'affiché dans le menu (ex. "1080p"). */
  get resolutionLabel(): string {
    return this.resolution.selectedOptions[0]?.text ?? "";
  }

  /** Appelé quand l'un des deux menus change. */
  onChange(callback: () => void) {
    this.resolution.addEventListener("change", callback);
    this.fps.addEventListener("change", callback);
  }
}

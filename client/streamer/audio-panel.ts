// Panneau « 🔊 Son du stream » de l'application de bureau : son ouverture / fermeture, son résumé,
// et la création du mélangeur (le mélange lui-même est dans desktop/audio-mixer.ts).

import type { AudioCaptureApi } from "../../shared/app-bridge.js";
import { $ } from "../core/dom.js";
import { setIconText } from "../core/icons.js";
import { loadPref, savePref } from "../core/prefs.js";
import { StreamAudioMixer } from "../desktop/audio-mixer.js";

export interface AudioPanel {
  /** Le mélangeur, une fois prêt (null pendant le démarrage, ou si le son par appli est impossible). */
  readonly mixer: StreamAudioMixer | null;
}

export function setupAudioPanel(app: AudioCaptureApi): AudioPanel {
  const state: { mixer: StreamAudioMixer | null } = { mixer: null };
  const audioPanel = $("audio-panel");
  audioPanel.hidden = false;

  // Bouton Réduire / Agrandir : réduit par défaut, le choix est retenu
  const audioBody = $("audio-body");
  const audioToggle = $("audio-toggle");
  const setAudioExpanded = (expanded: boolean) => {
    audioBody.hidden = !expanded;
    setIconText(audioToggle, expanded ? "chevron-down" : "chevron-right", expanded ? "Réduire" : "Agrandir");
    audioToggle.setAttribute("aria-expanded", String(expanded));
    savePref("audioExpanded", String(expanded));
  };
  setAudioExpanded(loadPref("audioExpanded") === "true");
  audioToggle.addEventListener("click", () => setAudioExpanded(audioBody.hidden !== false));

  // Résumé visible même panneau réduit : "2 applis envoyées sur 4"
  const audioSummary = $("audio-summary");
  const updateAudioSummary = () => {
    if (!state.mixer) return;
    const { sent, total } = state.mixer.summary();
    audioSummary.textContent =
      total === 0 ? "aucune appli ne joue de son" : `${sent} appli${sent > 1 ? "s" : ""} envoyée${sent > 1 ? "s" : ""} sur ${total}`;
  };

  void (async () => {
    const unsupported = () => {
      $("audio-unsupported").hidden = false;
      audioPanel.querySelector<HTMLElement>(".audio-master")!.hidden = true;
      $("audio-empty").hidden = true;
      audioSummary.textContent = "indisponible sur ce système";
    };
    if (!(await app.audioSupported())) return unsupported();
    try {
      state.mixer = await StreamAudioMixer.create(app, audioPanel);
      state.mixer.onChange = updateAudioSummary;
      updateAudioSummary();
    } catch (err) {
      console.error(err);
      unsupported();
    }
  })();

  return state;
}

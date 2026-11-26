// Panneau ⚙️ Options du spectateur : la qualité voulue et l'affichage des stats.

import type { ViewerQuality } from "../../shared/messages.js";
import { $ } from "../core/dom.js";
import { loadPref, savePref } from "../core/prefs.js";
import { isViewerQuality } from "../core/quality.js";

/**
 * Prépare le panneau. Renvoie la qualité retenue par le navigateur (sinon "max") ;
 * onQualityChange est appelé quand le spectateur en choisit une autre.
 */
export function setupOptionsPanel(onQualityChange: (quality: ViewerQuality) => void): ViewerQuality {
  $("viewer-options").hidden = false; // le bouton ⚙️ du header ne sert qu'au spectateur

  const optionsBtn = $("options-btn");
  const optionsPanel = $("options-panel");
  const setPanelOpen = (open: boolean) => {
    optionsPanel.hidden = !open;
    optionsBtn.setAttribute("aria-expanded", String(open));
  };
  // hidden peut valoir true, false ou "until-found" : tout sauf false = panneau fermé -> on l'ouvre
  optionsBtn.addEventListener("click", () => setPanelOpen(optionsPanel.hidden !== false));
  // Un clic ailleurs sur la page referme le panneau
  document.addEventListener("click", (e) => {
    if (!optionsPanel.hidden && !(e.target as Element).closest(".options")) setPanelOpen(false);
  });

  // Qualité : celle retenue par le navigateur, sinon "max". Un changement est retenu.
  const storedQuality = loadPref("quality") ?? "max";
  const quality: ViewerQuality = isViewerQuality(storedQuality) ? storedQuality : "max";
  const qualitySelect = $<HTMLSelectElement>("viewer-quality");
  qualitySelect.value = quality;
  qualitySelect.addEventListener("change", () => {
    if (!isViewerQuality(qualitySelect.value)) return;
    savePref("quality", qualitySelect.value);
    onQualityChange(qualitySelect.value);
  });

  // Afficher / masquer les stats (masquées par défaut)
  const showStats = $<HTMLInputElement>("show-stats");
  showStats.checked = loadPref("showStats") === "true";
  $("stats").hidden = !showStats.checked;
  showStats.addEventListener("change", () => {
    $("stats").hidden = !showStats.checked;
    savePref("showStats", String(showStats.checked));
  });

  return quality;
}

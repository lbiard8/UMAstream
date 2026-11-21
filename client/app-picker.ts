// Fenêtre de choix d'écran de l'application de bureau.
// Dans Chrome, c'est le navigateur qui affiche sa propre fenêtre ; Electron n'en a pas : on affiche
// donc les écrans et les fenêtres sous forme de miniatures, et on renvoie l'identifiant choisi.

import type { AppBridge, ScreenSource } from "../shared/app-bridge.js";

/** Ouvre la fenêtre de choix. Renvoie l'identifiant de la source choisie, ou null si annulé. */
export async function pickScreenSource(app: AppBridge): Promise<string | null> {
  const dialog = document.getElementById("source-picker") as HTMLDialogElement;
  const screens = document.getElementById("picker-screens")!;
  const windows = document.getElementById("picker-windows")!;
  const cancelBtn = document.getElementById("picker-cancel")!;

  let sources: ScreenSource[];
  try {
    sources = await app.listScreenSources();
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    const finish = (id: string | null) => {
      dialog.removeEventListener("close", onClose);
      cancelBtn.removeEventListener("click", onCancel);
      if (dialog.open) dialog.close();
      resolve(id);
    };
    const onClose = () => finish(null); // touche Échap
    const onCancel = () => finish(null);

    const tile = (source: ScreenSource) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "picker-tile";
      const img = document.createElement("img");
      img.src = source.thumbnail;
      img.alt = "";
      const label = document.createElement("span");
      label.textContent = source.name; // textContent : un titre de fenêtre reste du texte
      button.title = source.name;
      button.append(img, label);
      if (source.minimized) {
        // Fenêtre réduite : pas d'aperçu possible, juste l'icône du programme ; elle sera rouverte
        button.classList.add("is-minimized");
        const badge = document.createElement("span");
        badge.className = "picker-badge";
        badge.textContent = "réduite · sera rouverte";
        button.title = `${source.name} (réduite : UMAstream la rouvrira pour la partager)`;
        button.append(badge);
      }
      button.addEventListener("click", () => finish(source.id));
      return button;
    };
    screens.replaceChildren(...sources.filter((s) => s.kind === "screen").map(tile));
    windows.replaceChildren(...sources.filter((s) => s.kind === "window").map(tile));

    dialog.addEventListener("close", onClose);
    cancelBtn.addEventListener("click", onCancel);
    dialog.showModal();
  });
}

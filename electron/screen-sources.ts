// Choix de l'écran dans l'appli de bureau.
// Electron n'a pas la fenêtre de choix de Chrome : la page affiche la nôtre (miniatures), puis
// demande la source choisie ; getDisplayMedia() déclenche ensuite le gestionnaire installé ici, qui la fournit.

import { app, desktopCapturer, type Session } from "electron";
import type { ScreenSource } from "../shared/app-bridge.js";
import type { WindowHelper } from "./native-helper.js";

export class ScreenSources {
  private selectedSourceId: string | null = null;

  /** windows : pour proposer (et rouvrir) les fenêtres réduites. */
  constructor(private readonly windows: WindowHelper) {}

  /** Branche le choix sur les getDisplayMedia() de la page. */
  install(session: Session) {
    session.setDisplayMediaRequestHandler(async (_request, callback) => {
      const id = this.selectedSourceId;
      this.selectedSourceId = null; // une sélection = un seul partage
      const sources = id ? await desktopCapturer.getSources({ types: ["screen", "window"] }) : [];
      const source = sources.find((s) => s.id === id);
      // Sans source : getDisplayMedia() échoue dans la page, comme une fenêtre de choix annulée
      callback(source ? { video: source } : {});
    });
  }

  /** Écrans et fenêtres partageables, avec une miniature. */
  async list(): Promise<ScreenSource[]> {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
    });
    const capturable: ScreenSource[] = sources
      .filter((s) => s.name !== "UMAstream") // inutile de proposer notre propre fenêtre
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith("screen:") ? "screen" : "window",
        thumbnail: s.thumbnail.toDataURL(),
      }));

    // Fenêtres réduites : Electron ne les propose pas (Windows ne capture pas une fenêtre réduite).
    // On les ajoute, avec l'icône de leur programme ; les choisir les rouvrira (voir select).
    const minimized = await this.windows.listMinimizedWindows();
    const known = new Set(capturable.map((s) => s.id.split(":")[1])); // "window:<hwnd>:0" -> hwnd
    for (const win of minimized) {
      if (known.has(String(win.hwnd)) || win.title === "UMAstream") continue;
      let thumbnail = "";
      try {
        if (win.path) thumbnail = (await app.getFileIcon(win.path, { size: "large" })).toDataURL();
      } catch {
        /* pas d'icône : la fenêtre de choix affichera juste le titre */
      }
      capturable.push({ id: `minimized:${win.hwnd}`, name: win.title, kind: "window", thumbnail, minimized: true });
    }
    return capturable;
  }

  /** Choisit la source que le prochain getDisplayMedia() capturera. */
  async select(id: string) {
    if (!id.startsWith("minimized:")) {
      this.selectedSourceId = id;
      return;
    }
    // Fenêtre réduite : on la rouvre (sans qu'elle passe devant UMAstream), puis on attend qu'Electron
    // la voie apparaître dans ses sources ; son identifiant est alors "window:<hwnd>:…"
    const hwnd = id.slice("minimized:".length);
    if (!/^\d+$/.test(hwnd)) throw new Error("Fenêtre invalide");
    await this.windows.restoreWindow(hwnd);
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find((s) => s.id.startsWith(`window:${hwnd}:`));
      if (source) {
        this.selectedSourceId = source.id;
        return;
      }
    }
    throw new Error("Impossible de rouvrir cette fenêtre : rouvre-la toi-même, puis réessaie.");
  }
}

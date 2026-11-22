// Services offerts à la page (voir shared/app-bridge.ts et electron/preload.ts).
// Ce fichier ne fait que relier chaque canal à la classe qui fait le travail.

import { app, ipcMain } from "electron";
import type { AudioApp } from "../shared/app-bridge.js";
import type { NativeHelper } from "./native-helper.js";
import type { ScreenSources } from "./screen-sources.js";

export interface IpcServices {
  screens: ScreenSources;
  native: NativeHelper;
  /** Envoie un événement à la page (si la fenêtre existe encore). */
  sendToPage(channel: string, ...args: unknown[]): void;
  /** Ouvre la version navigateur. */
  openInBrowser(): Promise<void>;
}

export function registerIpc({ screens, native, sendToPage, openInBrowser }: IpcServices) {
  ipcMain.handle("audio:supported", () => native.audioSupported());

  ipcMain.handle("sources:list", () => screens.list());
  ipcMain.handle("sources:select", (_event, id: string) => screens.select(id));

  ipcMain.handle("audio:list", async (): Promise<AudioApp[]> => {
    // On ne se propose pas soi-même : ni les processus de cette appli, ni une autre appli UMAstream ouverte
    const ownPids = new Set(app.getAppMetrics().map((m) => m.pid));
    return (await native.listAudioApps()).filter(
      (a) => !ownPids.has(a.pid) && a.exe.toLowerCase() !== "umastream.exe",
    );
  });

  ipcMain.handle("audio:start", (_event, pid: number) =>
    native.startCapture(
      pid,
      (samples) => sendToPage("audio:data", pid, samples),
      (error) => sendToPage("audio:ended", pid, error),
    ),
  );
  ipcMain.handle("audio:stop", (_event, pid: number) => native.stopCapture(pid));

  ipcMain.handle("open-browser", () => openInBrowser());
}

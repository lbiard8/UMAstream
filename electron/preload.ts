// "Preload" : tout petit script qui tourne dans la page AVANT elle, avec un accès limité à Electron.
// Il expose `window.umastreamApp` (voir shared/app-bridge.ts) et RIEN d'autre : la page ne peut pas
// appeler Node.js ou Electron directement (contextIsolation + sandbox).

import { contextBridge, ipcRenderer } from "electron";
import type { AppBridge } from "../shared/app-bridge.js";

const bridge: AppBridge = {
  audioSupported: () => ipcRenderer.invoke("audio:supported"),
  listScreenSources: () => ipcRenderer.invoke("sources:list"),
  selectScreenSource: (id) => ipcRenderer.invoke("sources:select", id),
  listAudioApps: () => ipcRenderer.invoke("audio:list"),
  startAudioCapture: (pid) => ipcRenderer.invoke("audio:start", pid),
  stopAudioCapture: (pid) => ipcRenderer.invoke("audio:stop", pid),
  onAudioData: (callback) => {
    ipcRenderer.on("audio:data", (_event, pid: number, samples: Uint8Array) => callback(pid, samples));
  },
  onAudioEnded: (callback) => {
    ipcRenderer.on("audio:ended", (_event, pid: number, error: string | null) => callback(pid, error));
  },
  openInBrowser: () => ipcRenderer.invoke("open-browser"),
};

contextBridge.exposeInMainWorld("umastreamApp", bridge);

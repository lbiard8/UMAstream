// Application de bureau UMAstream (Electron) — processus principal.
//
// Elle fait tourner le MÊME serveur que `npm run share` (serveur + tunnel), puis affiche la page du
// streamer dans sa propre fenêtre. Par rapport à la version navigateur, elle ajoute :
//  - sa propre fenêtre de choix d'écran (et donc plus de barre « … partage votre écran » de Chrome) ;
//  - le son par application, grâce au petit programme natif umastream-audio.exe (native/audio-helper).
// Les spectateurs, eux, regardent toujours dans leur navigateur.

import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { release } from "node:os";
import { join } from "node:path";
import type { AudioApp, ScreenSource } from "../shared/app-bridge.js";

// --- Emplacements des fichiers -------------------------------------------------
// En développement (`npm run app`), tout est dans le dossier du projet.
// Une fois installée, l'appli range ses programmes dans resources/bin (voir "extraResources").
const APP_DIR = app.getAppPath();
const BIN_DIR = app.isPackaged ? join(process.resourcesPath, "bin") : null;
const AUDIO_HELPER = BIN_DIR
  ? join(BIN_DIR, "umastream-audio.exe")
  : join(APP_DIR, "native", "audio-helper", "target", "release", "umastream-audio.exe");
const BUNDLED_CLOUDFLARED = BIN_DIR ? join(BIN_DIR, "cloudflared.exe") : join(APP_DIR, "vendor", "cloudflared.exe");

// Les sons d'une page ne démarrent normalement qu'après un clic : ici, le mélangeur audio du
// stream doit pouvoir tourner dès l'ouverture (il ne joue rien sur les haut-parleurs).
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

/** Le son par application exige Windows 11 (ou Windows 10 build 20348+). */
function audioSupported(): boolean {
  if (process.platform !== "win32") return false;
  const build = Number(release().split(".")[2] ?? 0);
  return build >= 20348;
}

/** Premier port libre à partir de `start` (3000 est peut-être déjà pris par la version navigateur). */
async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 20; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer()
        .once("error", () => resolve(false))
        .once("listening", () => probe.close(() => resolve(true)))
        .listen(port);
    });
    if (free) return port;
  }
  throw new Error(`Aucun port libre entre ${start} et ${start + 19}.`);
}

// --- Démarrage -------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
let localUrl = "";

/** Une seule application à la fois : relancer l'icône ramène simplement la fenêtre au premier plan. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(start);
}

async function start() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 880,
    minWidth: 820,
    minHeight: 600,
    title: "UMAstream",
    icon: join(APP_DIR, "assets", "umastream.ico"),
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(APP_DIR, "dist", "preload.cjs"),
      contextIsolation: true, // la page ne voit que window.umastreamApp
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Petit écran d'attente pendant que le serveur et le tunnel démarrent (quelques secondes)
  await mainWindow.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        '<body style="background:#0f1115;color:#8b93a7;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">' +
          "<p>Démarrage d'UMAstream… (ouverture du lien internet)</p></body>",
      ),
  );

  // Réglages du serveur, lus par server/server.ts et server/network.ts
  const port = await findFreePort(Number(process.env.PORT ?? 3000));
  process.env.PORT = String(port);
  process.env.UMASTREAM_EMBEDDED = "1";
  process.env.UMASTREAM_TUNNEL = "1";
  process.env.UMASTREAM_PUBLIC_DIR = join(APP_DIR, "public");
  if (existsSync(BUNDLED_CLOUDFLARED)) process.env.UMASTREAM_CLOUDFLARED = BUNDLED_CLOUDFLARED;
  localUrl = `http://localhost:${port}`;

  try {
    // Import APRÈS avoir réglé l'environnement : le serveur démarre dès qu'il est chargé
    const server = await import("../server/server.js");
    await server.serverReady;
  } catch (err) {
    dialog.showErrorBox("UMAstream n'a pas pu démarrer", String(err instanceof Error ? err.message : err));
    app.quit();
    return;
  }

  setupScreenCapture();
  setupIpc();

  // Liens externes (version navigateur, sites…) : dans le navigateur, jamais dans l'appli
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(localUrl)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(`${localUrl}/`);
}

// Fermer la fenêtre = quitter : stream, serveur, tunnel et captures audio s'arrêtent ensemble
app.on("window-all-closed", () => app.quit());
app.on("will-quit", async () => {
  for (const child of audioCaptures.values()) child.kill();
  audioCaptures.clear();
  try {
    const { stopTunnel } = await import("../server/network.js");
    stopTunnel();
  } catch {
    /* le serveur n'avait pas démarré */
  }
});

// --- Choix de l'écran -------------------------------------------------------------
// Electron n'a pas la fenêtre de choix de Chrome : la page affiche la nôtre (miniatures), puis
// demande la source choisie ; getDisplayMedia() déclenche ensuite ce gestionnaire, qui la fournit.

let selectedSourceId: string | null = null;

function setupScreenCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const id = selectedSourceId;
    selectedSourceId = null; // une sélection = un seul partage
    const sources = id ? await desktopCapturer.getSources({ types: ["screen", "window"] }) : [];
    const source = sources.find((s) => s.id === id);
    // Sans source : getDisplayMedia() échoue dans la page, comme une fenêtre de choix annulée
    callback(source ? { video: source } : {});
  });
}

// --- Services offerts à la page (voir shared/app-bridge.ts) ------------------------

/** Captures de son en cours : pid de l'application -> programme umastream-audio.exe */
const audioCaptures = new Map<number, ChildProcess>();

function sendToPage(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

/** Lance umastream-audio.exe avec ces arguments et renvoie ce qu'il affiche. */
function runHelper(args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(AUDIO_HELPER, args, { windowsHide: true, timeout: 5000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    ),
  );
}

/** Fenêtres réduites dans la barre des tâches (vide si le programme natif est absent). */
async function listMinimizedWindows(): Promise<{ hwnd: number; title: string; exe: string; path: string }[]> {
  if (process.platform !== "win32" || !existsSync(AUDIO_HELPER)) return [];
  try {
    return JSON.parse(await runHelper(["windows"]));
  } catch {
    return [];
  }
}

function setupIpc() {
  ipcMain.handle("audio:supported", () => audioSupported() && existsSync(AUDIO_HELPER));

  ipcMain.handle("sources:list", async (): Promise<ScreenSource[]> => {
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
    // On les ajoute, avec l'icône de leur programme ; les choisir les rouvrira (voir sources:select).
    const minimized = await listMinimizedWindows();
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
  });

  ipcMain.handle("sources:select", async (_event, id: string) => {
    if (!id.startsWith("minimized:")) {
      selectedSourceId = id;
      return;
    }
    // Fenêtre réduite : on la rouvre (sans qu'elle passe devant UMAstream), puis on attend qu'Electron
    // la voie apparaître dans ses sources ; son identifiant est alors "window:<hwnd>:…"
    const hwnd = id.slice("minimized:".length);
    if (!/^\d+$/.test(hwnd)) throw new Error("Fenêtre invalide");
    await runHelper(["restore", hwnd]);
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find((s) => s.id.startsWith(`window:${hwnd}:`));
      if (source) {
        selectedSourceId = source.id;
        return;
      }
    }
    throw new Error("Impossible de rouvrir cette fenêtre : rouvre-la toi-même, puis réessaie.");
  });

  ipcMain.handle("audio:list", async (): Promise<AudioApp[]> => {
    if (!audioSupported() || !existsSync(AUDIO_HELPER)) return [];
    const output = await runHelper(["list"]);
    // On ne se propose pas soi-même : ni les processus de cette appli, ni une autre appli UMAstream ouverte
    const ownPids = new Set(app.getAppMetrics().map((m) => m.pid));
    return (JSON.parse(output) as AudioApp[]).filter(
      (a) => !ownPids.has(a.pid) && a.exe.toLowerCase() !== "umastream.exe",
    );
  });

  ipcMain.handle("audio:start", (_event, pid: number) => {
    if (!Number.isInteger(pid) || audioCaptures.has(pid)) return;
    const child = spawn(AUDIO_HELPER, ["capture", String(pid)], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    audioCaptures.set(pid, child);

    // Le tuyau peut couper un échantillon en deux : on n'envoie que des images stéréo complètes
    // (8 octets = 2 flottants de 4 octets) et on garde le reste pour le morceau suivant.
    let leftover: Buffer = Buffer.alloc(0);
    child.stdout?.on("data", (chunk: Buffer) => {
      const data = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = data.length - (data.length % 8);
      leftover = data.subarray(usable);
      if (usable > 0) sendToPage("audio:data", pid, new Uint8Array(data.subarray(0, usable)));
    });
    let errors = "";
    child.stderr?.on("data", (chunk: Buffer) => (errors += chunk.toString()));
    child.on("exit", (code) => {
      if (audioCaptures.get(pid) === child) audioCaptures.delete(pid);
      // Arrêt demandé (kill) : pas une erreur. Sinon on transmet le message du programme.
      sendToPage("audio:ended", pid, child.killed || code === 0 ? null : errors.trim() || `code ${code}`);
    });
    child.on("error", (err) => sendToPage("audio:ended", pid, err.message));
  });

  ipcMain.handle("audio:stop", (_event, pid: number) => {
    audioCaptures.get(pid)?.kill();
    audioCaptures.delete(pid);
  });

  ipcMain.handle("open-browser", () => shell.openExternal(`${localUrl}/`));
}

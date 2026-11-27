// Application de bureau UMAstream (Electron) — processus principal.
//
// Elle fait tourner le MÊME serveur que `npm run share` (serveur + tunnel), puis affiche la page du
// streamer dans sa propre fenêtre. Par rapport à la version navigateur, elle ajoute :
//  - sa propre fenêtre de choix d'écran (et donc plus de barre « … partage votre écran » de Chrome) ;
//  - le son par application, grâce au petit programme natif umastream-audio (native/audio-helper).
// Les spectateurs, eux, regardent toujours dans leur navigateur.

//
// Ce fichier crée la fenêtre et démarre le serveur ; le reste est rangé à part :
//   platform.ts        ce qui change entre Windows, macOS et Linux
//   native-helper.ts   le programme natif umastream-audio (son par appli, fenêtres réduites)
//   screen-sources.ts  la fenêtre de choix d'écran (côté Electron)
//   ipc.ts             les services offerts à la page (window.umastreamApp)

import { app, BrowserWindow, dialog, session, shell } from "electron";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { registerIpc } from "./ipc.js";
import { NativeHelper } from "./native-helper.js";
import { currentPlatform } from "./platform.js";
import { ScreenSources } from "./screen-sources.js";

// --- Emplacements des fichiers -------------------------------------------------
// En développement (`npm run app`), tout est dans le dossier du projet.
// Une fois installée, l'appli range ses programmes dans resources/bin (voir "extraResources").
// Les programmes s'appellent "….exe" sous Windows, sans extension sous macOS et Linux.
const APP_DIR = app.getAppPath();
const BIN_DIR = app.isPackaged ? join(process.resourcesPath, "bin") : null;
const exe = (name: string) => name + currentPlatform.exeSuffix;
const AUDIO_HELPER = BIN_DIR
  ? join(BIN_DIR, exe("umastream-audio"))
  : join(APP_DIR, "native", "audio-helper", "target", "release", exe("umastream-audio"));
const BUNDLED_CLOUDFLARED = BIN_DIR ? join(BIN_DIR, exe("cloudflared")) : join(APP_DIR, "vendor", exe("cloudflared"));

// Les sons d'une page ne démarrent normalement qu'après un clic : ici, le mélangeur audio du
// stream doit pouvoir tourner dès l'ouverture (il ne joue rien sur les haut-parleurs).
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const native = new NativeHelper(AUDIO_HELPER, currentPlatform);
const screens = new ScreenSources(native);

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
    ...(currentPlatform.windowIcon ? { icon: join(APP_DIR, currentPlatform.windowIcon) } : {}),
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

  screens.install(session.defaultSession);
  registerIpc({
    screens,
    native,
    sendToPage: (channel, ...args) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
    },
    openInBrowser: () => shell.openExternal(`${localUrl}/`),
  });

  // Liens externes (version navigateur, sites…) : dans le navigateur, jamais dans l'appli
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    // On compare l'origine EXACTE (protocole + nom + port) : « commence par http://localhost:3000 »
    // laisserait passer http://localhost:3000@autre-site.com, qui mène en réalité sur autre-site.com.
    if (!isAppPage(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(`${localUrl}/`);
}

// Fermer la fenêtre = quitter : stream, serveur, tunnel et captures audio s'arrêtent ensemble
app.on("window-all-closed", () => app.quit());
app.on("will-quit", async () => {
  native.stopAllCaptures();
  try {
    const { stopTunnel } = await import("../server/network.js");
    stopTunnel();
  } catch {
    /* le serveur n'avait pas démarré */
  }
});


/** L'adresse est-elle une page de l'appli (même origine que le serveur intégré) ? */
function isAppPage(url: string): boolean {
  try {
    return new URL(url).origin === new URL(localUrl).origin;
  } catch {
    return false; // adresse illisible : on ne la charge pas dans l'appli
  }
}

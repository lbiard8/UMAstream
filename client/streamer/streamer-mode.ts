// Mode streamer : on capture l'écran et on crée un salon.
//
// Ce fichier est le « chef d'orchestre » : il ne fait presque rien lui-même, il branche ensemble
// les morceaux qui ont chacun UN rôle (principe « S » de SOLID) :
//   QualityMenus   les menus Résolution / Fps
//   ScreenCapture  la capture de l'écran (démarrer, changer d'écran, changer la qualité)
//   ViewerPeers    les connexions vidéo, une par spectateur (pause, aveugle, qualité, relance)
//   WaitingRoom    la salle d'attente (accepter / refuser)
//   PeoplePanel    l'affichage du panneau de droite
//   live-panel     le lien à partager et l'état pause / direct
//   diagnostics    le bouton 🔧 Diagnostic

import type { AppBridge } from "../../shared/app-bridge.js";
import { $, setStatus } from "../core/dom.js";
import { ShareError } from "../core/errors.js";
import { SignalingClient, type SendMessage } from "../core/signaling.js";
import { setupAudioPanel, type AudioPanel } from "./audio-panel.js";
import { startStreamerDiagnostics } from "./diagnostics.js";
import { setupCopyButton, showPaused, showRoom } from "./live-panel.js";
import { PeoplePanel } from "./people-panel.js";
import { QualityMenus } from "./quality-menus.js";
import { browserCaptureSource, desktopCaptureSource, ScreenCapture, type CaptureSource } from "./screen-capture.js";
import { ViewerPeers } from "./viewer-peers.js";
import { WaitingRoom } from "./waiting-room.js";

/** desktopApp : présent seulement dans l'application de bureau (undefined dans le navigateur). */
export function startStreamerMode(desktopApp: AppBridge | undefined) {
  $("streamer-view").hidden = false;
  const startBtn = $<HTMLButtonElement>("start-btn");
  const passwordInput = $<HTMLInputElement>("stream-password");
  const menus = new QualityMenus($("resolution"), $("fps"));

  // On ne peut streamer que depuis le PC qui fait tourner UMAstream (le serveur le vérifie aussi).
  // Page ouverte via le tunnel ou l'IP locale : on prévient tout de suite, avant de choisir l'écran.
  const isLocalPage = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  if (!isLocalPage) {
    startBtn.disabled = true;
    setStatus(
      `Pour streamer, ouvre http://localhost:${location.port || "3000"} sur le PC qui fait tourner UMAstream. ` +
        "Cette adresse sert seulement à regarder un stream.",
      true,
    );
  }

  // Application de bureau : lien vers la version navigateur + son par application
  let audio: AudioPanel | null = null;
  if (desktopApp) {
    const browserBtn = $("browser-version-btn");
    browserBtn.hidden = false;
    browserBtn.addEventListener("click", () => void desktopApp.openInBrowser());
    audio = setupAudioPanel(desktopApp);
  }
  const source: CaptureSource = desktopApp
    ? desktopCaptureSource(desktopApp, () => audio?.mixer?.track ?? null)
    : browserCaptureSource;

  startBtn.addEventListener("click", () => {
    // Mot de passe obligatoire : on vérifie AVANT d'ouvrir la fenêtre de choix d'écran.
    // (Le serveur revérifie de son côté : on ne fait jamais confiance au seul navigateur.)
    const password = passwordInput.value;
    if (password.length === 0) {
      setStatus("Choisis un mot de passe : tes spectateurs devront le taper pour regarder.", true);
      passwordInput.focus();
      return;
    }
    void goLive(password, source, menus);
  });

  setupCopyButton();
}

/** Lance le stream : capture de l'écran, création du salon, puis gestion des spectateurs. */
async function goLive(password: string, source: CaptureSource, menus: QualityMenus) {
  // `let` : la qualité peut changer pendant le stream (menus Résolution / Fps)
  let quality = menus.selected();

  // 1. Capture de l'écran (fenêtre de choix d'écran)
  let capture: ScreenCapture;
  try {
    capture = await ScreenCapture.start(source, quality, () => stop());
  } catch (err) {
    setStatus(err instanceof ShareError ? err.message : "Partage annulé.", err instanceof ShareError);
    return;
  }

  const preview = $<HTMLVideoElement>("preview");
  preview.srcObject = capture.mediaStream;
  preview.hidden = false;
  $<HTMLButtonElement>("start-btn").disabled = true;
  $<HTMLInputElement>("stream-password").disabled = true; // le mot de passe est fixé pour toute la durée du stream
  // Les menus Résolution / Fps restent actifs : ils changent la qualité en direct (voir étape 5)

  // 2. Les morceaux du stream. Ils envoient leurs messages par `send`, sans connaître le WebSocket.
  const send: SendMessage = (msg) => signaling.send(msg);
  const peers = new ViewerPeers(send, capture, () => quality);
  const autoAccept = $<HTMLInputElement>("auto-accept");
  const waitingRoom = new WaitingRoom(send, () => autoAccept.checked);
  const panel = new PeoplePanel({
    answer: (id, accept) => waitingRoom.answer(id, accept),
    toggleBlind: (id) => void peers.toggleBlind(id),
    kick: (id) => send({ type: "kick", viewerId: id }),
  });
  const renderPeople = () => panel.render(waitingRoom.list(), peers.list());
  peers.onChange = renderPeople;
  waitingRoom.onChange = renderPeople;
  startStreamerDiagnostics(peers, () => quality.fps);

  // 3. Connexion au serveur de signalisation : un gestionnaire par message reçu
  const signaling = new SignalingClient({
    reconnect: false,
    onOpen: () => send({ type: "create-room", password }),
    onLost: () => setStatus("Connexion au serveur perdue.", true),
    handlers: {
      "room-created": (msg) => {
        showRoom(msg.roomId, msg.reach, msg.shareBase);
        renderPeople();
        setStatus("Envoie le lien à tes potes !");
      },
      // Bon mot de passe : quelqu'un attend notre accord (aucune connexion WebRTC pour l'instant)
      "join-request": (msg) => waitingRoom.request(msg.viewerId, msg.name),
      "join-request-cancelled": (msg) => waitingRoom.cancel(msg.viewerId),
      "viewer-joined": (msg) => peers.add(msg.viewerId, msg.name),
      signal: (msg) => peers.handleSignal(msg.from, msg.data),
      "viewer-left": (msg) => peers.remove(msg.viewerId),
      error: (msg) => setStatus(msg.message, true),
    },
  });

  // Arrêt : bouton "Arrêter" ou bouton natif du navigateur ("Arrêter le partage")
  const stop = () => {
    capture.stop();
    peers.closeAll();
    signaling.close();
    location.href = location.pathname; // retour à l'accueil
  };
  $("stop-btn").addEventListener("click", stop);

  // 4. Changer d'écran sans couper le stream : même salon, même lien, spectateurs toujours connectés.
  const switchBtn = $<HTMLButtonElement>("switch-btn");
  switchBtn.addEventListener("click", async () => {
    switchBtn.disabled = true; // évite d'ouvrir deux fenêtres de choix
    try {
      // (En pause, ou pour un spectateur aveugle, rien n'est envoyé pour autant.)
      await capture.switchSource(quality, () => peers.useNewTracks());
      preview.srcObject = capture.mediaStream;
      setStatus(peers.isPaused ? "Écran changé : il sera envoyé à la reprise." : "Écran changé !");
    } catch (err) {
      setStatus(
        err instanceof ShareError ? `${err.message} L'écran actuel continue.` : "Changement annulé : l'écran actuel continue.",
        err instanceof ShareError,
      );
    } finally {
      switchBtn.disabled = false;
    }
  });

  // 5. Changer la résolution / les fps en direct, sans rouvrir la fenêtre de choix d'écran.
  const applyStreamQuality = async () => {
    quality = menus.selected();
    try {
      await capture.applyQuality(quality);
    } catch (err) {
      console.error(err);
      setStatus("Impossible d'appliquer cette qualité à la capture.", true);
      return;
    }
    await peers.reapplyQualities();
    setStatus(`Qualité changée : ${menus.resolutionLabel} · ${quality.fps} fps`);
  };
  // File d'attente : si on change la résolution PUIS les fps très vite, les deux s'appliquent
  // l'un après l'autre, dans l'ordre, au lieu de se marcher dessus.
  let qualityQueue = Promise.resolve();
  menus.onChange(() => {
    qualityQueue = qualityQueue.then(applyStreamQuality);
  });

  // 6. Pause sans couper le stream : plus d'image ni de son envoyés, presque plus de bande passante.
  const pauseBtn = $<HTMLButtonElement>("pause-btn");
  pauseBtn.addEventListener("click", async () => {
    pauseBtn.disabled = true;
    try {
      const paused = !peers.isPaused;
      await peers.setPaused(paused);
      showPaused(paused);
      setStatus(paused ? "Stream en pause : tes spectateurs restent connectés." : "Stream repris !");
    } finally {
      pauseBtn.disabled = false;
    }
  });

  // 7. Accepter automatiquement : en la cochant, on accepte aussi ceux qui attendent déjà.
  autoAccept.addEventListener("change", () => {
    if (autoAccept.checked) waitingRoom.acceptAll();
  });
}

// Code du navigateur. Deux modes :
//  - streamer   : pas de ?room= dans l'URL -> on capture l'écran et on crée un salon
//  - spectateur : URL avec ?room=xxxx      -> on rejoint le salon et on affiche la vidéo

import {
  MAX_NAME_LENGTH,
  type ClientMessage,
  type ServerMessage,
  type ShareReach,
  type SignalData,
  type ViewerQuality,
} from "../shared/messages.js";

// Serveur STUN public : il aide chaque navigateur à découvrir son adresse publique
// pour traverser la box. (Pour les réseaux très fermés il faudra un serveur TURN : V2.)
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// Qualité du streamer = une résolution + un nombre d'images par seconde.
// bitrate = débit max envoyé à CHAQUE spectateur. À 60 fps il y a 2× plus d'images,
// mais l'encodeur les compresse mieux (elles se ressemblent) : environ ×1,5 de débit.
// width/height undefined = "native" : on capture l'écran à sa vraie résolution.
const RESOLUTIONS = {
  native: { width: undefined, height: undefined, bitrate: { 30: 14_000_000, 60: 20_000_000 } },
  "1080": { width: 1920, height: 1080, bitrate: { 30: 6_000_000, 60: 9_000_000 } },
  "720": { width: 1280, height: 720, bitrate: { 30: 3_000_000, 60: 4_500_000 } },
  "480": { width: 854, height: 480, bitrate: { 30: 1_500_000, 60: 2_200_000 } },
  "360": { width: 640, height: 360, bitrate: { 30: 800_000, 60: 1_200_000 } },
} as const;
type ResolutionKey = keyof typeof RESOLUTIONS;
type Fps = 30 | 60;

const isResolutionKey = (value: string): value is ResolutionKey => value in RESOLUTIONS;
const isFps = (value: number): value is Fps => value === 30 || value === 60;

/** Réglages complets d'encodage à partir des deux menus. */
function streamQuality(resolution: ResolutionKey, fps: Fps) {
  const r = RESOLUTIONS[resolution];
  return {
    width: r.width,
    height: r.height,
    fps,
    bitrate: r.bitrate[fps],
    // hint "detail" : quand le réseau sature, Chrome baisse les fps mais GARDE la résolution.
    // ("motion" ferait l'inverse : il retomberait en 360p/540p, justement ce qu'on veut éviter.)
    hint: "detail",
  } as const;
}

// Qualités qu'un spectateur peut demander. null = "max" : on garde les réglages du streamer.
// Le streamer plafonne toujours : on ne dépasse jamais SA résolution ni SON débit.
const VIEWER_PRESETS: Record<ViewerQuality, { height: number; bitrate: number } | null> = {
  max: null,
  "1080p": { height: 1080, bitrate: 8_000_000 },
  "720p": { height: 720, bitrate: 4_000_000 },
  "480p": { height: 480, bitrate: 1_500_000 },
  "360p": { height: 360, bitrate: 800_000 },
};

const isViewerQuality = (value: string): value is ViewerQuality => value in VIEWER_PRESETS;

// Explication affichée sous le lien, selon qui pourra l'ouvrir.
// Record<ShareReach, string> : TypeScript exige un texte pour CHAQUE cas possible.
const REACH_NOTE: Record<ShareReach, string> = {
  internet: "🌍 Lien accessible depuis n'importe où.",
  lan: "🏠 Lien valable seulement sur ton réseau (même box / Wi-Fi). Pour un lien internet : installe cloudflared puis lance npm run share",
  local: "💻 Lien valable seulement sur ce PC. Pour un lien internet : installe cloudflared puis lance npm run share",
};

// --- Petits utilitaires ------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setStatus(text: string, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

// Préférences retenues par le navigateur (localStorage). Le stockage peut être bloqué
// (navigation privée, cookies refusés) : dans ce cas on ignore l'erreur et on prend la valeur par défaut.
function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(`umastream.${key}`);
  } catch {
    return null;
  }
}
function savePref(key: string, value: string) {
  try {
    localStorage.setItem(`umastream.${key}`, value);
  } catch {
    /* stockage indisponible : le choix ne sera juste pas retenu */
  }
}

/** Ouvre la connexion WebSocket et traite les messages UN PAR UN, dans l'ordre. */
function connect(onMessage: (msg: ServerMessage) => Promise<void> | void) {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${location.host}`);

  // Les handlers WebRTC sont asynchrones. Sans cette file d'attente, un candidat ICE
  // pourrait être traité avant que l'offre soit appliquée -> erreur.
  let queue = Promise.resolve();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data) as ServerMessage;
    queue = queue.then(() => onMessage(msg)).catch((err) => console.error(err));
  });

  const send = (msg: ClientMessage) => ws.send(JSON.stringify(msg));
  return { ws, send };
}

// --- Mode streamer -----------------------------------------------------------

function startStreamerMode() {
  $("streamer-view").hidden = false;
  const startBtn = $<HTMLButtonElement>("start-btn");
  const resolutionSelect = $<HTMLSelectElement>("resolution");
  const fpsSelect = $<HTMLSelectElement>("fps");

  // Les menus reprennent le dernier choix (sinon 1080p / 60, sélectionnés dans le HTML).
  // On vérifie la valeur retenue : une ancienne valeur ou une valeur bricolée est ignorée.
  const storedResolution = loadPref("streamResolution");
  if (storedResolution && isResolutionKey(storedResolution)) resolutionSelect.value = storedResolution;
  const storedFps = Number(loadPref("streamFps"));
  if (isFps(storedFps)) fpsSelect.value = String(storedFps);

  resolutionSelect.addEventListener("change", () => savePref("streamResolution", resolutionSelect.value));
  fpsSelect.addEventListener("change", () => savePref("streamFps", fpsSelect.value));

  /** Qualité correspondant à ce qui est sélectionné dans les deux menus. */
  const selectedQuality = () => {
    const resolution = isResolutionKey(resolutionSelect.value) ? resolutionSelect.value : "1080";
    const fps = Number(fpsSelect.value);
    return streamQuality(resolution, isFps(fps) ? fps : 60);
  };

  const passwordInput = $<HTMLInputElement>("stream-password");
  const autoAccept = $<HTMLInputElement>("auto-accept");

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

  startBtn.addEventListener("click", async () => {
    // Mot de passe obligatoire : on vérifie AVANT d'ouvrir la fenêtre de choix d'écran.
    // (Le serveur revérifie de son côté : on ne fait jamais confiance au seul navigateur.)
    const password = passwordInput.value;
    if (password.length === 0) {
      setStatus("Choisis un mot de passe : tes spectateurs devront le taper pour regarder.", true);
      passwordInput.focus();
      return;
    }

    // `let` : la qualité peut changer pendant le stream (menus Résolution / Fps)
    let quality = selectedQuality();

    /** Ouvre la fenêtre de choix d'écran du navigateur (au démarrage, puis à chaque "Changer d'écran"). */
    const captureScreen = async () => {
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: quality.width && { ideal: quality.width },
          height: quality.height && { ideal: quality.height },
          frameRate: { ideal: quality.fps },
        },
        audio: true, // son du PC : marche avec Chrome/Edge en partageant l'écran entier ou un onglet
      });
      // Indice pour l'encodeur : "motion" = garder les fps, "detail" = garder la netteté
      captured.getVideoTracks()[0]!.contentHint = quality.hint;
      return captured;
    };

    // 1. Capture de l'écran (le navigateur affiche sa fenêtre de choix)
    // `let` : stream et videoTrack sont remplacés quand on change d'écran.
    let stream: MediaStream;
    try {
      stream = await captureScreen();
    } catch {
      setStatus("Partage annulé.");
      return;
    }
    let videoTrack = stream.getVideoTracks()[0]!;

    // Flux "étiquette" commun à la vidéo et au son : côté spectateur, les deux pistes arrivent
    // ainsi dans le MÊME MediaStream (celui affiché par <video>), même après un changement d'écran.
    const outStream = new MediaStream();

    const preview = $<HTMLVideoElement>("preview");
    preview.srcObject = stream;
    preview.hidden = false;
    startBtn.disabled = true;
    passwordInput.disabled = true; // le mot de passe est fixé pour toute la durée du stream
    // Les menus Résolution / Fps restent actifs : ils changent la qualité en direct (voir étape 6)

    // 2. Connexion au serveur de signalisation
    const peerConnections = new Map<string, RTCPeerConnection>(); // une par spectateur
    // Qualité demandée par chaque spectateur : à réappliquer quand on change d'écran,
    // car le nouvel écran n'a pas forcément la même résolution.
    const viewerQualities = new Map<string, ViewerQuality>();
    // Pause : la capture continue sur ce PC, mais plus rien n'est envoyé aux spectateurs (voir étape 7)
    let paused = false;
    // Panneau de droite : pseudos des spectateurs, ceux rendus aveugles, et la salle d'attente
    const viewerNames = new Map<string, string>(); // viewerId -> pseudo
    const blindViewers = new Set<string>(); // ne reçoivent plus ni image ni son
    const pendingRequests = new Map<string, string>(); // viewerId -> pseudo, en attente d'accord
    const updateCount = () => ($("viewer-count").textContent = String(peerConnections.size));
    startStreamerDiagnostics(peerConnections, () => quality.fps);

    /**
     * Envoie (ou coupe) l'image et le son vers UN spectateur, selon l'état actuel :
     * rien n'est envoyé si le stream est en pause OU si ce spectateur est rendu aveugle.
     * replaceTrack(null) coupe l'envoi sans fermer la connexion, replaceTrack(piste) le relance.
     */
    const updateSending = async (viewerId: string, pc: RTCPeerConnection) => {
      const sending = !paused && !blindViewers.has(viewerId);
      const audioTrack = stream.getAudioTracks()[0] ?? null;
      for (const transceiver of pc.getTransceivers()) {
        // receiver.track existe toujours (même si sender.track est vide) : il donne le type d'emplacement
        const kind = transceiver.receiver.track.kind;
        await transceiver.sender.replaceTrack(sending ? (kind === "video" ? videoTrack : audioTrack) : null);
      }
    };

    /**
     * Applique la qualité demandée par UN spectateur, sur SA connexion uniquement.
     * setParameters() change l'encodage à chaud : pas de renégociation, pas de coupure.
     */
    const applyViewerQuality = async (pc: RTCPeerConnection, preset: ViewerQuality) => {
      // On cherche l'emplacement vidéo par son TYPE (receiver.track existe toujours), pas par sa piste :
      // pendant une pause, sender.track vaut null, et le réglage serait sinon perdu.
      const sender = pc.getTransceivers().find((t) => t.receiver.track.kind === "video")?.sender;
      if (!sender) return;
      const params = sender.getParameters();
      const encoding = params.encodings[0];
      if (!encoding) return; // pas encore négocié

      const target = VIEWER_PRESETS[preset];
      const sourceHeight = videoTrack.getSettings().height ?? 1080;
      // scaleResolutionDownBy = "divise la résolution par…" : 1080 / 720 = 1,5 -> 720p.
      // Math.max(1, …) : on ne grossit jamais l'image au-delà de ce que capture le streamer.
      encoding.scaleResolutionDownBy = target ? Math.max(1, sourceHeight / target.height) : 1;
      encoding.maxBitrate = target ? Math.min(quality.bitrate, target.bitrate) : quality.bitrate;
      // Les fps du streamer peuvent changer en direct : on met aussi à jour le plafond d'images/s
      encoding.maxFramerate = quality.fps;
      await sender.setParameters(params);
    };

    const { ws, send } = connect(async (msg) => {
      switch (msg.type) {
        case "room-created": {
          // Le serveur connaît une adresse joignable par les autres PC (tunnel ou IP locale).
          // location.origin vaudrait "http://localhost:3000", qui ne marche que sur CE PC.
          const base = msg.shareBase ?? location.origin;
          $<HTMLInputElement>("share-link").value = `${base}/?room=${msg.roomId}`;
          $("reach-note").textContent = REACH_NOTE[msg.reach];
          $("reach-note").dataset.reach = msg.reach;
          // En pair à pair, chaque spectateur reçoit l'IP du streamer (candidats ICE).
          // Inutile de prévenir si le lien ne sort pas de ce PC.
          $("privacy-note").hidden = msg.reach === "local";
          $("live-panel").hidden = false;
          $("people-panel").hidden = false;
          $("streamer-view").classList.add("is-live"); // passe en 2 colonnes
          renderPeople();
          setStatus("Envoie le lien à tes potes !");
          break;
        }

        case "join-request":
          // Bon mot de passe : quelqu'un attend notre accord (aucune connexion WebRTC pour l'instant)
          if (autoAccept.checked) {
            send({ type: "join-answer", viewerId: msg.viewerId, accept: true });
          } else {
            pendingRequests.set(msg.viewerId, msg.name);
            renderPeople();
          }
          break;

        case "join-request-cancelled":
          // Il a fermé la page pendant l'attente
          pendingRequests.delete(msg.viewerId);
          renderPeople();
          break;

        case "viewer-joined": {
          // 3. Un spectateur arrive (accepté) : on crée une connexion WebRTC dédiée et on lui fait une offre
          const pc = new RTCPeerConnection(RTC_CONFIG);
          peerConnections.set(msg.viewerId, pc);
          viewerNames.set(msg.viewerId, msg.name);
          updateCount();
          renderPeople();

          pc.onicecandidate = (e) => {
            if (e.candidate) {
              send({ type: "signal", to: msg.viewerId, data: { kind: "ice", candidate: e.candidate.toJSON() } });
            }
          };

          // sendEncodings permet de fixer le débit max : c'est ce qui fait la différence de qualité.
          // En pause, on réserve l'emplacement ("video" = vide) sans rien envoyer : la reprise le remplira.
          pc.addTransceiver(paused ? "video" : videoTrack, {
            direction: "sendonly",
            streams: [outStream],
            sendEncodings: [{ maxBitrate: quality.bitrate, maxFramerate: quality.fps }],
          });
          // Emplacement audio TOUJOURS réservé, même si l'écran actuel n'a pas de son ("audio" = vide).
          // replaceTrack() ne peut remplir qu'un emplacement qui existe déjà : sans ça, passer d'une
          // fenêtre muette à un onglet avec du son obligerait à renégocier la connexion.
          const audioTrack = stream.getAudioTracks()[0];
          pc.addTransceiver(!paused && audioTrack ? audioTrack : "audio", { direction: "sendonly", streams: [outStream] });

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send({ type: "signal", to: msg.viewerId, data: { kind: "offer", sdp: offer.sdp! } });
          // Arrivé pendant une pause : on le lui dit tout de suite (sinon il attendrait l'image sans savoir pourquoi)
          if (paused) send({ type: "signal", to: msg.viewerId, data: { kind: "pause", paused: true } });
          break;
        }

        case "signal": {
          const pc = peerConnections.get(msg.from);
          if (!pc) break;
          if (msg.data.kind === "quality") {
            viewerQualities.set(msg.from, msg.data.preset);
            await applyViewerQuality(pc, msg.data.preset);
          } else {
            await applySignal(pc, msg.data);
          }
          break;
        }

        case "viewer-left": {
          peerConnections.get(msg.viewerId)?.close();
          peerConnections.delete(msg.viewerId);
          viewerQualities.delete(msg.viewerId);
          viewerNames.delete(msg.viewerId);
          blindViewers.delete(msg.viewerId);
          updateCount();
          renderPeople();
          break;
        }

        case "error":
          setStatus(msg.message, true);
          break;
      }
    });

    ws.addEventListener("open", () => send({ type: "create-room", password }));
    ws.addEventListener("close", () => setStatus("Connexion au serveur perdue.", true));

    // 4. Arrêt : bouton "Arrêter" ou bouton natif du navigateur ("Arrêter le partage")
    const stop = () => {
      stream.getTracks().forEach((t) => t.stop());
      peerConnections.forEach((pc) => pc.close());
      ws.close();
      location.href = location.pathname; // retour à l'accueil
    };
    videoTrack.addEventListener("ended", stop);
    $("stop-btn").addEventListener("click", stop);

    // 5. Changer d'écran sans couper le stream : même salon, même lien, spectateurs toujours connectés.
    const switchBtn = $<HTMLButtonElement>("switch-btn");
    switchBtn.addEventListener("click", async () => {
      switchBtn.disabled = true; // évite d'ouvrir deux fenêtres de choix
      try {
        let newStream: MediaStream;
        try {
          newStream = await captureScreen();
        } catch {
          setStatus("Changement annulé : l'écran actuel continue.");
          return;
        }

        const oldStream = stream;
        const oldVideoTrack = videoTrack;
        stream = newStream;
        videoTrack = newStream.getVideoTracks()[0]!;

        // replaceTrack() : on change ce qui est envoyé, sans renégocier. Le spectateur voit juste l'image changer.
        // (En pause, ou pour un spectateur aveugle, updateSending n'envoie toujours rien.)
        for (const [viewerId, pc] of peerConnections) {
          await updateSending(viewerId, pc);
          // La résolution du nouvel écran peut être différente : on recalcule la qualité de ce spectateur
          await applyViewerQuality(pc, viewerQualities.get(viewerId) ?? "max");
        }

        // PIÈGE : l'ancienne piste déclenchait stop() à sa fin. On détache l'écouteur AVANT de l'arrêter,
        // sinon changer d'écran couperait tout le stream.
        oldVideoTrack.removeEventListener("ended", stop);
        oldStream.getTracks().forEach((t) => t.stop());
        videoTrack.addEventListener("ended", stop);

        preview.srcObject = stream;
        setStatus(paused ? "Écran changé : il sera envoyé à la reprise." : "Écran changé !");
      } finally {
        switchBtn.disabled = false;
      }
    });

    // 6. Changer la résolution / les fps en direct, sans rouvrir la fenêtre de choix d'écran.
    // applyConstraints() redimensionne la capture en cours : même écran, spectateurs toujours connectés.
    const applyStreamQuality = async () => {
      quality = selectedQuality();
      // "Native" : on redemande la taille maximale de l'écran partagé (sinon la capture resterait réduite)
      const caps = videoTrack.getCapabilities();
      const width = quality.width ?? caps.width?.max;
      const height = quality.height ?? caps.height?.max;
      try {
        await videoTrack.applyConstraints({
          width: width && { ideal: width },
          height: height && { ideal: height },
          frameRate: { ideal: quality.fps },
        });
      } catch (err) {
        console.error(err);
        setStatus("Impossible d'appliquer cette qualité à la capture.", true);
        return;
      }
      // Nouveau débit, nouvelle résolution source : on réapplique la qualité choisie par CHAQUE spectateur
      // (un spectateur en 1080p redescend en 720p si le streamer passe en 720p, et remonte ensuite).
      for (const [viewerId, pc] of peerConnections) {
        await applyViewerQuality(pc, viewerQualities.get(viewerId) ?? "max");
      }
      const label = resolutionSelect.selectedOptions[0]?.text ?? "";
      setStatus(`Qualité changée : ${label} · ${quality.fps} fps`);
    };

    // File d'attente : si on change la résolution PUIS les fps très vite, les deux s'appliquent
    // l'un après l'autre, dans l'ordre, au lieu de se marcher dessus.
    let qualityQueue = Promise.resolve();
    const onQualityChange = () => {
      qualityQueue = qualityQueue.then(applyStreamQuality);
    };
    resolutionSelect.addEventListener("change", onQualityChange);
    fpsSelect.addEventListener("change", onQualityChange);

    // 7. Pause sans couper le stream : même salon, même lien, connexions toujours ouvertes.
    // replaceTrack(null) arrête l'envoi (plus d'image ni de son, presque plus de bande passante) ;
    // chez le spectateur, la dernière image reste figée avec un bandeau "Stream en pause".
    const pauseBtn = $<HTMLButtonElement>("pause-btn");
    pauseBtn.addEventListener("click", async () => {
      pauseBtn.disabled = true;
      try {
        paused = !paused;
        for (const [viewerId, pc] of peerConnections) {
          await updateSending(viewerId, pc); // un spectateur aveugle reste aveugle à la reprise
          // À la reprise, l'écran ou la qualité ont pu changer pendant la pause : on réapplique
          if (!paused) await applyViewerQuality(pc, viewerQualities.get(viewerId) ?? "max");
          send({ type: "signal", to: viewerId, data: { kind: "pause", paused } });
        }
        pauseBtn.textContent = paused ? "▶ Reprendre" : "⏸ Pause";
        $("live-label").textContent = paused ? "En pause" : "En direct";
        $("live-panel").classList.toggle("is-paused", paused);
        setStatus(paused ? "Stream en pause : tes spectateurs restent connectés." : "Stream repris !");
      } finally {
        pauseBtn.disabled = false;
      }
    });

    // 8. Panneau de droite : salle d'attente (✅ / ❌) et spectateurs (👁️ / 🙈, 👢)
    // Les pseudos sont tapés par les spectateurs : on les affiche avec textContent, JAMAIS innerHTML.
    // Sinon un pseudo comme "<img src=x onerror=…>" exécuterait du code chez le streamer (faille XSS).
    const answer = (viewerId: string, accept: boolean) => {
      pendingRequests.delete(viewerId);
      send({ type: "join-answer", viewerId, accept });
      renderPeople();
    };

    const toggleBlind = async (viewerId: string) => {
      const pc = peerConnections.get(viewerId);
      if (!pc) return;
      const blinded = !blindViewers.has(viewerId);
      if (blinded) blindViewers.add(viewerId);
      else blindViewers.delete(viewerId);
      renderPeople();
      await updateSending(viewerId, pc);
      if (!blinded) await applyViewerQuality(pc, viewerQualities.get(viewerId) ?? "max");
      send({ type: "signal", to: viewerId, data: { kind: "blind", blinded } });
    };

    /** Petit bouton avec un émoji, et un libellé lisible au survol et par les lecteurs d'écran. */
    const iconButton = (emoji: string, label: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.textContent = emoji;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.addEventListener("click", onClick);
      return btn;
    };

    /** Une ligne de liste : le pseudo, puis les boutons. */
    const personRow = (name: string, buttons: HTMLButtonElement[]) => {
      const li = document.createElement("li");
      const nameEl = document.createElement("span");
      nameEl.className = "name";
      nameEl.textContent = name; // textContent : le pseudo est affiché comme du texte, jamais interprété
      nameEl.title = name;
      li.append(nameEl, ...buttons);
      return li;
    };

    function renderPeople() {
      const pendingList = $("pending-list");
      pendingList.replaceChildren(
        ...[...pendingRequests].map(([id, name]) =>
          personRow(name, [
            iconButton("✅", `Accepter ${name}`, () => answer(id, true)),
            iconButton("❌", `Refuser ${name}`, () => answer(id, false)),
          ]),
        ),
      );
      const viewerList = $("viewer-list");
      viewerList.replaceChildren(
        ...[...viewerNames].map(([id, name]) => {
          const blind = blindViewers.has(id);
          const row = personRow(name, [
            // L'émoji montre l'ÉTAT actuel : 👁️ il voit, 🙈 il est aveugle. Un clic inverse.
            iconButton(blind ? "🙈" : "👁️", blind ? `Rendre la vue à ${name}` : `Rendre ${name} aveugle`, () =>
              void toggleBlind(id),
            ),
            iconButton("👢", `Expulser ${name}`, () => send({ type: "kick", viewerId: id })),
          ]);
          row.classList.toggle("is-blind", blind);
          return row;
        }),
      );
      $("pending-count").textContent = String(pendingRequests.size);
      $("watching-count").textContent = String(viewerNames.size);
      // "Personne pour l'instant" sous une liste vide
      for (const empty of document.querySelectorAll<HTMLElement>(".people-empty")) {
        empty.hidden = $(empty.dataset.for!).childElementCount > 0;
      }
    }

    // Accepter automatiquement : décochée par défaut. En la cochant, on accepte aussi ceux qui attendent déjà.
    autoAccept.addEventListener("change", () => {
      if (!autoAccept.checked) return;
      for (const id of [...pendingRequests.keys()]) answer(id, true);
    });
  });

  $("copy-btn").addEventListener("click", async () => {
    await navigator.clipboard.writeText($<HTMLInputElement>("share-link").value);
    $("copy-btn").textContent = "Copié !";
    setTimeout(() => ($("copy-btn").textContent = "Copier le lien"), 1500);
  });
}

// --- Diagnostic côté streamer ------------------------------------------------

const LIMITATION_LABEL: Record<string, string> = {
  none: "rien",
  cpu: "processeur",
  bandwidth: "débit",
  other: "autre",
};

/**
 * Affiche chaque seconde, pour chaque spectateur, ce que l'encodeur envoie vraiment
 * et SURTOUT pourquoi il réduit la qualité (qualityLimitationReason) :
 *   - "processeur" : l'encodage est trop lourd pour le CPU (souvent VP8 en logiciel)
 *   - "débit"      : la connexion ou notre plafond maxBitrate ne suit pas
 * Les pourcentages "depuis le début" montrent la part du temps passée limitée,
 * pratique pour les chutes brèves (gros mouvements de caméra, effets).
 */
function startStreamerDiagnostics(peerConnections: Map<string, RTCPeerConnection>, getTargetFps: () => number) {
  // Valeurs de la seconde précédente, pour calculer ce qui s'est passé PENDANT la dernière seconde
  const last = new Map<
    string,
    { bytes: number; time: number; encoded: number; encodeTime: number; captured: number }
  >();

  // Bouton 🔧 Diagnostic : affiche / masque la zone (masquée par défaut)
  const diagBtn = $("diag-btn");
  diagBtn.addEventListener("click", () => {
    const show = $("streamer-stats").hidden !== false;
    $("streamer-stats").hidden = !show;
    diagBtn.setAttribute("aria-expanded", String(show));
  });

  setInterval(async () => {
    // Zone masquée : inutile de lire les stats
    if ($("streamer-stats").hidden !== false) return;
    if (peerConnections.size === 0) {
      $("streamer-stats").textContent = "Diagnostic : en attente d'un spectateur…";
      return;
    }
    const lines: string[] = [];
    let index = 0;

    for (const [viewerId, pc] of peerConnections) {
      index++;
      // Les champs des stats varient selon les navigateurs : on les lit de façon souple.
      const stats = [...(await pc.getStats()).values()] as Record<string, any>[];
      const out = stats.find((s) => s.type === "outbound-rtp" && s.kind === "video");
      const source = stats.find((s) => s.type === "media-source" && s.kind === "video");
      const pair = stats.find((s) => s.type === "candidate-pair" && s.nominated && s.state === "succeeded");

      // La capture est la même pour tout le monde : on l'affiche une seule fois
      if (index === 1 && source) {
        lines.push(`Capture : ${source.width}×${source.height} · ${Math.round(source.framesPerSecond ?? 0)} fps`);
      }
      if (!out) {
        lines.push(`Spectateur ${index} : connexion en cours…`);
        continue;
      }

      const prev = last.get(viewerId);
      const now = {
        bytes: out.bytesSent ?? 0,
        time: out.timestamp,
        encoded: out.framesEncoded ?? 0,
        encodeTime: out.totalEncodeTime ?? 0, // en secondes, cumulé
        captured: source?.frames ?? 0, // images produites par la capture, cumulé
      };
      last.set(viewerId, now);
      const mbps = prev ? ((now.bytes - prev.bytes) * 8) / ((now.time - prev.time) * 1000) : 0;

      // Temps moyen pour encoder UNE image pendant la dernière seconde.
      // À 60 fps, le budget est de 16,7 ms par image : au-delà, le processeur ne suit plus.
      const encodedDelta = prev ? now.encoded - prev.encoded : 0;
      const encodeMs = encodedDelta > 0 ? ((now.encodeTime - prev!.encodeTime) / encodedDelta) * 1000 : 0;
      // Images capturées mais jamais encodées : l'encodeur les a sautées pour tenir son débit cible
      const capturedDelta = prev ? now.captured - prev.captured : 0;
      const skippedPct = capturedDelta > 0 ? Math.max(0, Math.round((1 - encodedDelta / capturedDelta) * 100)) : 0;
      const targetMbps = out.targetBitrate ? (out.targetBitrate / 1e6).toFixed(1) : "?";

      const durations: Record<string, number> = out.qualityLimitationDurations ?? {};
      const total = Object.values(durations).reduce((a, b) => a + b, 0) || 1;
      const pct = (key: string) => Math.round(((durations[key] ?? 0) / total) * 100);

      const codec = stats.find((s) => s.id === out.codecId)?.mimeType?.replace("video/", "") ?? "?";
      const hardware =
        out.powerEfficientEncoder === true ? "matériel" : out.powerEfficientEncoder === false ? "logiciel" : "?";
      const available = pair?.availableOutgoingBitrate
        ? `${(pair.availableOutgoingBitrate / 1e6).toFixed(1)} Mb/s`
        : "?";

      lines.push(
        `Spectateur ${index} : envoyé ${out.frameWidth ?? "?"}×${out.frameHeight ?? "?"} · ` +
          `${Math.round(out.framesPerSecond ?? 0)} fps · ${mbps.toFixed(1)} Mb/s (débit dispo estimé : ${available})`,
        `  Encodage : ${encodeMs.toFixed(1)} ms/image (budget ${(1000 / getTargetFps()).toFixed(1)} ms à ${getTargetFps()} fps)` +
          ` · images sautées : ${skippedPct} % · débit cible encodeur : ${targetMbps} Mb/s`,
        `  Limité maintenant par : ${LIMITATION_LABEL[out.qualityLimitationReason] ?? "?"}` +
          ` · depuis le début : processeur ${pct("cpu")} %, débit ${pct("bandwidth")} %`,
        `  Codec : ${codec}` +
          (out.encoderImplementation ? ` · encodeur : ${out.encoderImplementation} (${hardware})` : ""),
      );
    }
    $("streamer-stats").textContent = lines.join("\n");
  }, 1000);
}

// --- Mode spectateur ---------------------------------------------------------

function startViewerMode(roomId: string) {
  $("viewer-view").hidden = false;
  $("viewer-options").hidden = false; // le bouton ⚙️ du header ne sert qu'au spectateur
  const video = $<HTMLVideoElement>("remote");
  let pc: RTCPeerConnection | null = null;

  // Qualité choisie : celle retenue par le navigateur, sinon "max"
  const storedQuality = loadPref("quality") ?? "max";
  let viewerQuality: ViewerQuality = isViewerQuality(storedQuality) ? storedQuality : "max";
  const qualitySelect = $<HTMLSelectElement>("viewer-quality");
  qualitySelect.value = viewerQuality;

  // Formulaire du mot de passe
  const passwordForm = $<HTMLFormElement>("password-form");
  const passwordInput = $<HTMLInputElement>("viewer-password");
  const passwordBtn = $<HTMLButtonElement>("password-btn");
  const passwordError = $("password-error");
  // Pseudo : retenu par le navigateur (ce n'est pas une info secrète), pour ne pas le retaper à chaque stream
  const nameInput = $<HTMLInputElement>("viewer-name");
  nameInput.maxLength = MAX_NAME_LENGTH;
  nameInput.value = loadPref("name") ?? "";

  /** Formulaire hors service (bloqué, refusé, expulsé) : on le désactive entièrement. */
  const lockForm = () => {
    nameInput.disabled = true;
    passwordInput.disabled = true;
    passwordBtn.disabled = true;
  };

  // Bandeau par-dessus la vidéo : "aveugle" passe avant "pause" (c'est ce qui le concerne lui)
  let paused = false;
  let blinded = false;
  const updateBanner = () => {
    const banner = $("video-banner");
    banner.hidden = !paused && !blinded;
    banner.textContent = blinded ? "🙈 Le streamer a masqué l'image pour toi" : "⏸ Stream en pause";
  };

  setStatus("Connexion au salon…");

  const { ws, send } = connect(async (msg) => {
    switch (msg.type) {
      case "password-required":
        // Le salon existe : on demande le mot de passe (le streamer ne sait même pas qu'on est là)
        setStatus("");
        passwordForm.hidden = false;
        (nameInput.value ? passwordInput : nameInput).focus();
        break;

      case "password-wrong":
        passwordError.textContent = `Mot de passe incorrect : ${msg.attemptsLeft} essai(s) restant(s).`;
        passwordInput.value = "";
        passwordBtn.disabled = false;
        passwordInput.focus();
        break;

      case "blocked": {
        // Bloqué pour cette adresse IP (trop d'erreurs, ou refusé récemment) : le serveur coupe la connexion
        const minutes = Math.ceil(msg.retryAfterSeconds / 60);
        const why = msg.reason === "refused" ? "Le streamer a refusé ta demande." : "Trop d'essais.";
        passwordForm.hidden = false;
        passwordError.textContent = `${why} Réessaie dans ${minutes} minute(s), en rechargeant la page.`;
        lockForm();
        setStatus("");
        break;
      }

      case "waiting-approval":
        // Bon mot de passe : on attend que le streamer clique sur Accepter
        passwordForm.hidden = true;
        setStatus("⏳ En attente de l'accord du streamer…");
        break;

      case "join-refused":
        lockForm();
        setStatus("Le streamer a refusé ta demande.", true);
        break;

      case "kicked":
        pc?.close();
        video.srcObject = null;
        $("player").hidden = true;
        setStatus("👢 Tu as été expulsé du stream.", true);
        break;

      case "joined":
        // Accepté par le streamer : on cache le formulaire et on affiche le lecteur
        passwordForm.hidden = true;
        $("player").hidden = false;
        setStatus("En attente du flux vidéo…");
        break;

      case "signal": {
        if (msg.data.kind === "offer") {
          // Le streamer nous fait une offre : on crée notre connexion et on répond
          pc = new RTCPeerConnection(RTC_CONFIG);
          pc.onicecandidate = (e) => {
            if (e.candidate) {
              send({ type: "signal", to: "streamer", data: { kind: "ice", candidate: e.candidate.toJSON() } });
            }
          };
          pc.ontrack = (e) => {
            video.srcObject = e.streams[0]!;
            setStatus("");
          };
          pc.onconnectionstatechange = () => {
            if (pc?.connectionState === "failed") {
              setStatus("Impossible d'établir la connexion directe (réseau trop restrictif ?).", true);
            }
          };

          await pc.setRemoteDescription({ type: "offer", sdp: msg.data.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: "signal", to: "streamer", data: { kind: "answer", sdp: answer.sdp! } });
          // Juste après la réponse : on annonce la qualité voulue (le streamer l'applique
          // dès qu'il a traité la réponse, les messages arrivant dans l'ordre)
          send({ type: "signal", to: "streamer", data: { kind: "quality", preset: viewerQuality } });
          startStats(pc);
        } else if (msg.data.kind === "pause") {
          // La connexion reste ouverte : la dernière image reste figée, on affiche juste le bandeau
          paused = msg.data.paused;
          updateBanner();
          if (paused) setStatus("");
        } else if (msg.data.kind === "blind") {
          // Le streamer ne nous envoie plus ni image ni son (à nous seulement)
          blinded = msg.data.blinded;
          updateBanner();
        } else if (pc) {
          await applySignal(pc, msg.data);
        }
        break;
      }

      case "stream-ended":
        setStatus("Le stream est terminé.");
        pc?.close();
        video.srcObject = null;
        break;

      case "error":
        setStatus(msg.message, true);
        passwordBtn.disabled = false; // ex. "Choisis un pseudo" : on peut corriger et réessayer
        break;
    }
  });

  // 1er contact sans mot de passe : le serveur répond "password-required" si le salon existe
  ws.addEventListener("open", () => send({ type: "join-room", roomId }));

  passwordForm.addEventListener("submit", (e) => {
    e.preventDefault(); // sinon le navigateur rechargerait la page en envoyant le formulaire
    const name = nameInput.value.trim();
    if (name.length === 0) {
      passwordError.textContent = "Choisis un pseudo : c'est lui que le streamer verra.";
      nameInput.focus();
      return;
    }
    if (passwordInput.value.length === 0) return;
    savePref("name", name);
    passwordBtn.disabled = true; // un seul essai à la fois
    passwordError.textContent = "";
    setStatus("");
    send({ type: "join-room", roomId, password: passwordInput.value, name });
  });

  // Les navigateurs bloquent la lecture automatique AVEC son : on démarre muet,
  // et l'utilisateur clique pour activer le son.
  $("unmute-btn").addEventListener("click", () => {
    video.muted = !video.muted;
    $("unmute-btn").textContent = video.muted ? "🔊 Activer le son" : "🔇 Couper le son";
  });
  // Plein écran sur le bloc vidéo + stats (et non la seule <video>), pour garder les stats visibles
  $("fullscreen-btn").addEventListener("click", () => $("video-wrap").requestFullscreen());

  // --- Panneau ⚙️ Options ---
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

  // Changement de qualité : on le retient et on prévient le streamer tout de suite
  qualitySelect.addEventListener("change", () => {
    if (!isViewerQuality(qualitySelect.value)) return;
    viewerQuality = qualitySelect.value;
    savePref("quality", viewerQuality);
    if (pc) send({ type: "signal", to: "streamer", data: { kind: "quality", preset: viewerQuality } });
  });

  // Afficher / masquer les stats (masquées par défaut)
  const showStats = $<HTMLInputElement>("show-stats");
  showStats.checked = loadPref("showStats") === "true";
  $("stats").hidden = !showStats.checked;
  showStats.addEventListener("change", () => {
    $("stats").hidden = !showStats.checked;
    savePref("showStats", String(showStats.checked));
  });
}

/** Affiche la résolution, les fps et le débit reçus : la preuve qu'on dépasse le 720p ! */
function startStats(pc: RTCPeerConnection) {
  let lastBytes = 0;
  let lastTime = 0;
  const timer = setInterval(async () => {
    if (pc.connectionState === "closed") return clearInterval(timer);
    const report = await pc.getStats();
    report.forEach((s) => {
      if (s.type !== "inbound-rtp" || s.kind !== "video") return;
      const mbps = lastTime ? ((s.bytesReceived - lastBytes) * 8) / ((s.timestamp - lastTime) * 1000) : 0;
      lastBytes = s.bytesReceived;
      lastTime = s.timestamp;
      if (s.frameWidth) {
        $("stats").textContent =
          `${s.frameWidth}×${s.frameHeight} · ${Math.round(s.framesPerSecond ?? 0)} fps · ${mbps.toFixed(1)} Mb/s`;
      }
    });
  }, 1000);
}

// --- Commun ------------------------------------------------------------------

async function applySignal(pc: RTCPeerConnection, data: SignalData) {
  if (data.kind === "answer") {
    await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
  } else if (data.kind === "ice") {
    await pc.addIceCandidate(data.candidate);
  }
}

// --- Point d'entrée ----------------------------------------------------------

const roomId = new URLSearchParams(location.search).get("room");
if (roomId) startViewerMode(roomId);
else startStreamerMode();

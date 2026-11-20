// Code du navigateur. Deux modes :
//  - streamer   : pas de ?room= dans l'URL -> on capture l'écran et on crée un salon
//  - spectateur : URL avec ?room=xxxx      -> on rejoint le salon et on affiche la vidéo

import type { ClientMessage, ServerMessage, ShareReach, SignalData } from "../shared/messages.js";

// Serveur STUN public : il aide chaque navigateur à découvrir son adresse publique
// pour traverser la box. (Pour les réseaux très fermés il faudra un serveur TURN : V2.)
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// Préréglages de qualité. maxBitrate = débit max envoyé à CHAQUE spectateur.
// hint "detail" : quand le réseau sature, Chrome baisse les fps mais GARDE la résolution.
// ("motion" ferait l'inverse : il retomberait en 360p/540p, justement ce qu'on veut éviter.)
const QUALITY = {
  "1080p60": { width: 1920, height: 1080, fps: 60, bitrate: 8_000_000, hint: "detail" },
  "1080p30": { width: 1920, height: 1080, fps: 30, bitrate: 6_000_000, hint: "detail" },
  "1440p60": { width: 2560, height: 1440, fps: 60, bitrate: 14_000_000, hint: "detail" },
  source: { width: undefined, height: undefined, fps: 60, bitrate: 12_000_000, hint: "detail" },
} as const;
type QualityKey = keyof typeof QUALITY;

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
  const qualitySelect = $<HTMLSelectElement>("quality");

  startBtn.addEventListener("click", async () => {
    const quality = QUALITY[qualitySelect.value as QualityKey];

    // 1. Capture de l'écran (le navigateur affiche sa fenêtre de choix)
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: quality.width && { ideal: quality.width },
          height: quality.height && { ideal: quality.height },
          frameRate: { ideal: quality.fps },
        },
        audio: true, // son du PC : marche avec Chrome/Edge en partageant l'écran entier ou un onglet
      });
    } catch {
      setStatus("Partage annulé.");
      return;
    }

    const videoTrack = stream.getVideoTracks()[0]!;
    // Indice pour l'encodeur : "motion" = garder les fps, "detail" = garder la netteté
    videoTrack.contentHint = quality.hint;

    const preview = $<HTMLVideoElement>("preview");
    preview.srcObject = stream;
    preview.hidden = false;
    startBtn.disabled = true;
    qualitySelect.disabled = true;

    // 2. Connexion au serveur de signalisation
    const peerConnections = new Map<string, RTCPeerConnection>(); // une par spectateur
    const updateCount = () => ($("viewer-count").textContent = String(peerConnections.size));

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
          setStatus("Envoie le lien à tes potes !");
          break;
        }

        case "viewer-joined": {
          // 3. Un spectateur arrive : on crée une connexion WebRTC dédiée et on lui fait une offre
          const pc = new RTCPeerConnection(RTC_CONFIG);
          peerConnections.set(msg.viewerId, pc);
          updateCount();

          pc.onicecandidate = (e) => {
            if (e.candidate) {
              send({ type: "signal", to: msg.viewerId, data: { kind: "ice", candidate: e.candidate.toJSON() } });
            }
          };

          // sendEncodings permet de fixer le débit max : c'est ce qui fait la différence de qualité
          pc.addTransceiver(videoTrack, {
            direction: "sendonly",
            streams: [stream],
            sendEncodings: [{ maxBitrate: quality.bitrate, maxFramerate: quality.fps }],
          });
          for (const audioTrack of stream.getAudioTracks()) {
            pc.addTransceiver(audioTrack, { direction: "sendonly", streams: [stream] });
          }

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send({ type: "signal", to: msg.viewerId, data: { kind: "offer", sdp: offer.sdp! } });
          break;
        }

        case "signal": {
          const pc = peerConnections.get(msg.from);
          if (pc) await applySignal(pc, msg.data);
          break;
        }

        case "viewer-left": {
          peerConnections.get(msg.viewerId)?.close();
          peerConnections.delete(msg.viewerId);
          updateCount();
          break;
        }

        case "error":
          setStatus(msg.message, true);
          break;
      }
    });

    ws.addEventListener("open", () => send({ type: "create-room" }));
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
  });

  $("copy-btn").addEventListener("click", async () => {
    await navigator.clipboard.writeText($<HTMLInputElement>("share-link").value);
    $("copy-btn").textContent = "Copié !";
    setTimeout(() => ($("copy-btn").textContent = "Copier le lien"), 1500);
  });
}

// --- Mode spectateur ---------------------------------------------------------

function startViewerMode(roomId: string) {
  $("viewer-view").hidden = false;
  const video = $<HTMLVideoElement>("remote");
  let pc: RTCPeerConnection | null = null;

  setStatus("Connexion au salon…");

  const { ws, send } = connect(async (msg) => {
    switch (msg.type) {
      case "joined":
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
          startStats(pc);
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
        break;
    }
  });

  ws.addEventListener("open", () => send({ type: "join-room", roomId }));

  // Les navigateurs bloquent la lecture automatique AVEC son : on démarre muet,
  // et l'utilisateur clique pour activer le son.
  $("unmute-btn").addEventListener("click", () => {
    video.muted = !video.muted;
    $("unmute-btn").textContent = video.muted ? "🔊 Activer le son" : "🔇 Couper le son";
  });
  $("fullscreen-btn").addEventListener("click", () => video.requestFullscreen());
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

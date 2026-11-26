// Stats du spectateur, sous la vidéo.

import { $ } from "../core/dom.js";

/** Affiche la résolution, les fps et le débit reçus : la preuve qu'on dépasse le 720p ! */
export function startStats(pc: RTCPeerConnection) {
  // Débit = (octets reçus maintenant - octets reçus la fois d'avant) / temps écoulé, pour l'image et le son
  const last = { video: { bytes: 0, time: 0 }, audio: { bytes: 0, time: 0 } };
  const rate = (kind: "video" | "audio", bytes: number, time: number) => {
    const prev = last[kind];
    const bitsPerMs = prev.time ? ((bytes - prev.bytes) * 8) / (time - prev.time) : 0;
    last[kind] = { bytes, time };
    return bitsPerMs * 1000; // bits par seconde
  };
  const timer = setInterval(async () => {
    if (pc.connectionState === "closed") return clearInterval(timer);
    const report = await pc.getStats();
    let videoText = "";
    let audioKbps = 0;
    report.forEach((s) => {
      if (s.type !== "inbound-rtp") return;
      if (s.kind === "audio") {
        audioKbps = rate("audio", s.bytesReceived, s.timestamp) / 1000;
      } else if (s.kind === "video") {
        const mbps = rate("video", s.bytesReceived, s.timestamp) / 1e6;
        if (s.frameWidth) {
          videoText = `${s.frameWidth}×${s.frameHeight} · ${Math.round(s.framesPerSecond ?? 0)} fps · ${mbps.toFixed(1)} Mb/s`;
        }
      }
    });
    if (videoText) $("stats").textContent = `${videoText} · 🔊 ${Math.round(audioKbps)} kb/s`;
  }, 1000);
}

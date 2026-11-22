// Réglages et outils WebRTC communs au streamer et au spectateur.

import type { SignalData } from "../../shared/messages.js";

// Serveur STUN public : il aide chaque navigateur à découvrir son adresse publique
// pour traverser la box. (Pour les réseaux très fermés il faudra un serveur TURN : V2.)
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

/** Débit du son du stream : 128 kb/s, de quoi garder la musique et le son des jeux en bonne qualité. */
export const AUDIO_BITRATE = 128_000;

/**
 * Son stéréo haute qualité. Par défaut, WebRTC règle le codec Opus pour la VOIX : mono, environ
 * 32 kb/s. On modifie la description de la session (le SDP, un texte que les deux navigateurs
 * s'échangent) pour demander la stéréo et 128 kb/s. Il faut le faire des deux côtés : le streamer
 * dans son offre, le spectateur dans sa réponse.
 */
export function highQualityOpus(sdp: string): string {
  const rtpmap = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!rtpmap) return sdp; // pas d'Opus : on ne touche à rien
  const payload = rtpmap[1];
  const wanted: Record<string, string> = {
    stereo: "1",
    "sprop-stereo": "1",
    maxaveragebitrate: String(AUDIO_BITRATE),
  };
  const fmtp = new RegExp(`a=fmtp:${payload} ([^\\r\\n]*)`);
  const existing = sdp.match(fmtp);
  if (!existing) return sdp.replace(rtpmap[0], `${rtpmap[0]}\r\na=fmtp:${payload} ${toParams(wanted)}`);
  // On garde les paramètres déjà présents (ex. useinbandfec=1) et on ajoute / remplace les nôtres
  const params: Record<string, string> = {};
  for (const part of existing[1]!.split(";")) {
    const [key, value] = part.split("=");
    if (key) params[key.trim()] = (value ?? "").trim();
  }
  return sdp.replace(fmtp, `a=fmtp:${payload} ${toParams({ ...params, ...wanted })}`);
}

const toParams = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join(";");

/** Applique une réponse ou un candidat ICE reçu de l'autre navigateur. */
export async function applySignal(pc: RTCPeerConnection, data: SignalData) {
  if (data.kind === "answer") {
    await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
  } else if (data.kind === "ice") {
    await pc.addIceCandidate(data.candidate);
  }
}

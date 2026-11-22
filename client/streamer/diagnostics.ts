// Bouton 🔧 Diagnostic du streamer : ce que l'encodeur envoie vraiment à chaque spectateur.

import { $ } from "../core/dom.js";

/** Les connexions à examiner (fournies par ViewerPeers). */
export interface DiagnosticTarget {
  readonly size: number;
  connections(): Iterable<[viewerId: string, pc: RTCPeerConnection]>;
}

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
export function startStreamerDiagnostics(peers: DiagnosticTarget, getTargetFps: () => number) {
  // Valeurs de la seconde précédente, pour calculer ce qui s'est passé PENDANT la dernière seconde
  const last = new Map<
    string,
    { bytes: number; time: number; encoded: number; encodeTime: number; captured: number }
  >();
  const lastAudio = new Map<string, { bytes: number; time: number }>();

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
    if (peers.size === 0) {
      $("streamer-stats").textContent = "Diagnostic : en attente d'un spectateur…";
      return;
    }
    const lines: string[] = [];
    let index = 0;

    for (const [viewerId, pc] of peers.connections()) {
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

      // Le son : débit envoyé, et mono / stéréo (le codec Opus annonce son nombre de canaux)
      const audioOut = stats.find((s) => s.type === "outbound-rtp" && s.kind === "audio");
      if (audioOut) {
        const prevAudio = lastAudio.get(viewerId);
        lastAudio.set(viewerId, { bytes: audioOut.bytesSent ?? 0, time: audioOut.timestamp });
        const kbps = prevAudio
          ? (((audioOut.bytesSent ?? 0) - prevAudio.bytes) * 8) / (audioOut.timestamp - prevAudio.time)
          : 0;
        const audioCodec = stats.find((s) => s.id === audioOut.codecId);
        const channels = audioCodec?.channels === 2 ? "stéréo" : audioCodec?.channels === 1 ? "mono" : "?";
        lines.push(`  Son : ${Math.round(kbps)} kb/s · ${audioCodec?.mimeType?.replace("audio/", "") ?? "?"} ${channels}`);
      }
    }
    $("streamer-stats").textContent = lines.join("\n");
  }, 1000);
}

// Réglages de qualité : ceux du streamer (résolution + fps) et ceux qu'un spectateur peut demander.

import type { ViewerQuality } from "../../shared/messages.js";

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
export type ResolutionKey = keyof typeof RESOLUTIONS;
export type Fps = 30 | 60;

export const isResolutionKey = (value: string): value is ResolutionKey => value in RESOLUTIONS;
export const isFps = (value: number): value is Fps => value === 30 || value === 60;

/** Réglages complets d'encodage à partir des deux menus. */
export function streamQuality(resolution: ResolutionKey, fps: Fps) {
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
export type StreamQuality = ReturnType<typeof streamQuality>;

// Qualités qu'un spectateur peut demander. null = "max" : on garde les réglages du streamer.
// Le streamer plafonne toujours : on ne dépasse jamais SA résolution ni SON débit.
export const VIEWER_PRESETS: Record<ViewerQuality, { height: number; bitrate: number } | null> = {
  max: null,
  "1080p": { height: 1080, bitrate: 8_000_000 },
  "720p": { height: 720, bitrate: 4_000_000 },
  "480p": { height: 480, bitrate: 1_500_000 },
  "360p": { height: 360, bitrate: 800_000 },
};

export const isViewerQuality = (value: string): value is ViewerQuality => value in VIEWER_PRESETS;

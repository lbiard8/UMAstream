// Ce qui change d'un système à l'autre (Windows, macOS, Linux), réuni ici : le reste de l'appli
// demande à ce fichier au lieu de tester `process.platform` un peu partout.

import { release } from "node:os";

export type OsName = "windows" | "macos" | "linux";

export interface PlatformInfo {
  os: OsName;
  /** Extension des programmes : ".exe" sous Windows, rien ailleurs. */
  exeSuffix: string;
  /** Icône de la fenêtre (macOS prend celle du paquet .app : null). */
  windowIcon: string | null;
  /** Le système permet-il le son par application ? */
  appAudioSupported(): boolean;
}

/** Version du noyau sous forme de nombres : "23.2.0" -> [23, 2, 0]. */
function kernelVersion(): number[] {
  return release()
    .split(/[.-]/)
    .map((part) => Number(part) || 0);
}

const windows: PlatformInfo = {
  os: "windows",
  exeSuffix: ".exe",
  windowIcon: "assets/umastream.ico",
  // "Process loopback" : Windows 11, ou Windows 10 build 20348+ ("10.0.22631" -> 22631)
  appAudioSupported: () => (kernelVersion()[2] ?? 0) >= 20348,
};

const macos: PlatformInfo = {
  os: "macos",
  exeSuffix: "",
  windowIcon: null,
  // Core Audio "process taps" : macOS 14.2+, c'est-à-dire le noyau Darwin 23.2+
  appAudioSupported: () => {
    const [major = 0, minor = 0] = kernelVersion();
    return major > 23 || (major === 23 && minor >= 2);
  },
};

const linux: PlatformInfo = {
  os: "linux",
  exeSuffix: "",
  windowIcon: "assets/umastream.png",
  // PulseAudio ou PipeWire : présents sur presque tous les bureaux Linux (sinon la liste reste vide)
  appAudioSupported: () => true,
};

export const currentPlatform: PlatformInfo =
  process.platform === "win32" ? windows : process.platform === "darwin" ? macos : linux;

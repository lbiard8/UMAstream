// Le petit programme natif umastream-audio (native/audio-helper, .exe sous Windows) : son par application et
// fenêtres réduites. Ce fichier est le SEUL à savoir comment on le lance et comment il répond.

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { AudioApp } from "../shared/app-bridge.js";
import type { PlatformInfo } from "./platform.js";

/** Une fenêtre réduite dans la barre des tâches. */
export interface MinimizedWindow {
  hwnd: number;
  title: string;
  exe: string;
  path: string;
}

/** Ce que le choix d'écran utilise du programme natif (rien sur le son). */
export interface WindowHelper {
  listMinimizedWindows(): Promise<MinimizedWindow[]>;
  restoreWindow(hwnd: string): Promise<void>;
}

export class NativeHelper implements WindowHelper {
  /** Captures de son en cours : pid de l'application -> programme umastream-audio */
  private readonly captures = new Map<number, ChildProcess>();

  constructor(
    private readonly exePath: string,
    private readonly platform: PlatformInfo,
  ) {}

  private get installed() {
    return existsSync(this.exePath);
  }

  /** Le son par application est-il possible ici ? */
  audioSupported(): boolean {
    return this.platform.appAudioSupported() && this.installed;
  }

  /** Lance umastream-audio avec ces arguments et renvoie ce qu'il affiche. */
  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) =>
      execFile(this.exePath, args, { windowsHide: true, timeout: 5000 }, (err, stdout) =>
        err ? reject(err) : resolve(stdout),
      ),
    );
  }

  /** Fenêtres réduites dans la barre des tâches (vide si le programme natif est absent). */
  async listMinimizedWindows(): Promise<MinimizedWindow[]> {
    // Seul Windows en a besoin (ailleurs, Electron voit déjà les fenêtres réduites)
    if (this.platform.os !== "windows" || !this.installed) return [];
    try {
      return JSON.parse(await this.run(["windows"]));
    } catch {
      return [];
    }
  }

  /** Rouvre une fenêtre réduite, sans qu'elle passe devant UMAstream. */
  async restoreWindow(hwnd: string): Promise<void> {
    await this.run(["restore", hwnd]);
  }

  /** Applications qui ont une session audio. */
  async listAudioApps(): Promise<AudioApp[]> {
    if (!this.audioSupported()) return [];
    return JSON.parse(await this.run(["list"])) as AudioApp[];
  }

  /**
   * Commence à capturer le son d'une application.
   * onData reçoit des images stéréo complètes ; onEnded est appelé à la fin (error = null si demandé).
   */
  startCapture(pid: number, onData: (samples: Uint8Array) => void, onEnded: (error: string | null) => void) {
    if (!Number.isInteger(pid) || this.captures.has(pid)) return;
    const child = spawn(this.exePath, ["capture", String(pid)], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.captures.set(pid, child);

    // Le tuyau peut couper un échantillon en deux : on n'envoie que des images stéréo complètes
    // (8 octets = 2 flottants de 4 octets) et on garde le reste pour le morceau suivant.
    let leftover: Buffer = Buffer.alloc(0);
    child.stdout?.on("data", (chunk: Buffer) => {
      const data = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = data.length - (data.length % 8);
      leftover = data.subarray(usable);
      if (usable > 0) onData(new Uint8Array(data.subarray(0, usable)));
    });
    let errors = "";
    child.stderr?.on("data", (chunk: Buffer) => (errors += chunk.toString()));
    child.on("exit", (code) => {
      if (this.captures.get(pid) === child) this.captures.delete(pid);
      // Arrêt demandé (kill) : pas une erreur. Sinon on transmet le message du programme.
      onEnded(child.killed || code === 0 ? null : errors.trim() || `code ${code}`);
    });
    child.on("error", (err) => onEnded(err.message));
  }

  stopCapture(pid: number) {
    this.captures.get(pid)?.kill();
    this.captures.delete(pid);
  }

  stopAllCaptures() {
    for (const child of this.captures.values()) child.kill();
    this.captures.clear();
  }
}

// Ce que l'application de bureau (Electron) ajoute à la page, via `window.umastreamApp`.
// Dans la version navigateur, `window.umastreamApp` n'existe pas : la page fonctionne comme avant.
//
// Pourquoi un "pont" : la page web n'a (volontairement) pas accès au PC. C'est le processus principal
// d'Electron qui liste les écrans, lance la capture du son des applications, etc. ; la page lui demande
// ces services à travers ce petit jeu de fonctions, et rien d'autre (contextIsolation + sandbox).

/** Un écran ou une fenêtre qu'on peut partager. */
export interface ScreenSource {
  id: string; // "minimized:<hwnd>" pour une fenêtre réduite (rouverte quand on la choisit)
  name: string;
  kind: "screen" | "window";
  thumbnail: string; // image miniature, ou icône du programme pour une fenêtre réduite (data:image/png;base64,…)
  minimized?: boolean; // fenêtre réduite : Windows ne peut pas la capturer avant qu'elle soit rouverte
}

/** Une application qui a une session audio (comme dans le mélangeur de volume de Windows). */
export interface AudioApp {
  pid: number;
  exe: string; // ex. "Discord.exe"
  active: boolean; // émet du son en ce moment
}

// Le pont est découpé en petites interfaces (principe « I » de SOLID : ségrégation des interfaces) :
// chaque partie de la page ne dépend QUE des services qu'elle utilise. Le choix d'écran ne voit pas
// le son, le mélangeur ne voit pas les écrans.

/** Choix de l'écran ou de la fenêtre à partager. */
export interface ScreenSourceApi {
  /** Écrans et fenêtres partageables, avec une miniature. */
  listScreenSources(): Promise<ScreenSource[]>;
  /** Choisit la source que le prochain getDisplayMedia() capturera (rouvre d'abord une fenêtre réduite). */
  selectScreenSource(id: string): Promise<void>;
}

/** Capture du son, application par application. */
export interface AudioCaptureApi {
  /** Le son par application est-il possible sur ce Windows ? (Windows 11 / Windows 10 build 20348+) */
  audioSupported(): Promise<boolean>;
  /** Applications qui ont une session audio. */
  listAudioApps(): Promise<AudioApp[]>;
  /** Commence / arrête la capture du son d'une application. */
  startAudioCapture(pid: number): Promise<void>;
  stopAudioCapture(pid: number): Promise<void>;
  /** Reçoit le son capturé : flottants 32 bits, 48 kHz, stéréo entrelacé. */
  onAudioData(callback: (pid: number, samples: Uint8Array) => void): void;
  /** Une capture s'est arrêtée (application fermée, Windows trop ancien…). */
  onAudioEnded(callback: (pid: number, error: string | null) => void): void;
}

/** Liens vers l'extérieur de l'appli. */
export interface ShellApi {
  /** Ouvre la version navigateur (moins fonctionnelle) dans le navigateur par défaut. */
  openInBrowser(): Promise<void>;
}

/** Tout ce que l'application de bureau offre à la page. */
export interface AppBridge extends ScreenSourceApi, AudioCaptureApi, ShellApi {}

declare global {
  interface Window {
    umastreamApp?: AppBridge;
  }
}

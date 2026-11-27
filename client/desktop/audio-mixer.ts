// Panneau « 🔊 Son du stream » (application de bureau uniquement).
//
// Chaque application qui a une session audio a sa ligne : une case (envoyée ou non dans le stream),
// un indicateur de niveau et un volume. Ces réglages ne touchent QUE le stream : ce que tu entends
// toi-même ne change pas.
//
// Comment le son circule, pour chaque application cochée :
//   umastream-audio capture <pid>  (lancé par le processus principal d'Electron)
//     -> morceaux de son envoyés à la page (window.umastreamApp.onAudioData)
//     -> lecteur "pcm-player" (AudioWorklet) -> mesure du niveau -> volume de l'appli
//     -> volume général -> piste audio du stream (MediaStreamAudioDestinationNode)
// Les applications de vocal (Discord…) sont décochées par défaut : tes potes ne s'entendent pas en écho.

import type { AudioCaptureApi, AudioApp } from "../../shared/app-bridge.js";

/**
 * Applications de vocal : décochées par défaut (nom de l'exécutable sans ".exe", en minuscules).
 * Les noms changent selon le système : "Discord.exe" (Windows), "Discord" (macOS : nom de l'appli),
 * "discord" (Linux), "zoom.us" (macOS)…
 */
const VOICE_APPS = new Set([
  "discord", "discordptb", "discordcanary", "teamspeak", "ts3client_win64", "ts3client_win32",
  "teams", "ms-teams", "msteams", "zoom", "skype", "mumble", "slack", "signal", "whatsapp",
  "telegram", "guilded", "element", "webex", "ciscocollabhost",
  // macOS et Linux
  "zoom.us", "microsoft teams", "teams-for-linux", "telegram desktop", "telegram-desktop", "facetime",
  "skypeforlinux", "signal-desktop", "vesktop",
]);

/** Noms lisibles des applications courantes (sinon : le nom de l'exécutable). */
const FRIENDLY_NAMES: Record<string, string> = {
  chrome: "Google Chrome", msedge: "Microsoft Edge", firefox: "Firefox", opera: "Opera", brave: "Brave",
  discord: "Discord", discordptb: "Discord PTB", discordcanary: "Discord Canary", spotify: "Spotify",
  steam: "Steam", steamwebhelper: "Steam", vlc: "VLC", obs64: "OBS", teams: "Teams", "ms-teams": "Teams",
  zoom: "Zoom", ts3client_win64: "TeamSpeak", teamspeak: "TeamSpeak", wmplayer: "Lecteur Windows Media",
  "microsoft.media.player": "Lecteur multimédia", deezer: "Deezer", applemusic: "Apple Music",
  // Linux (sous macOS, le nom de l'appli est déjà lisible : "Google Chrome", "Spotify"…)
  "google-chrome": "Google Chrome", chromium: "Chromium", "chromium-browser": "Chromium", "zoom.us": "Zoom",
  "teams-for-linux": "Teams", "telegram-desktop": "Telegram", "signal-desktop": "Signal", vesktop: "Discord (Vesktop)",
};

const exeBase = (exe: string) => exe.toLowerCase().replace(/\.exe$/, "");
export const isVoiceApp = (exe: string) => VOICE_APPS.has(exeBase(exe));
export const friendlyName = (exe: string) => FRIENDLY_NAMES[exeBase(exe)] ?? exe.replace(/\.exe$/i, "");

// --- Préférences retenues par application (même nom d'exécutable = mêmes réglages la prochaine fois) ---

interface AppPref {
  checked: boolean;
  volume: number; // 0 à 1
}
function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : réglage non retenu */
  }
}
const prefKey = (exe: string) => `umastream.audio.${exeBase(exe)}`;

// --- Le mélangeur -------------------------------------------------------------

interface Channel {
  app: AudioApp;
  checked: boolean;
  volume: number;
  capturing: boolean;
  error: string | null;
  player: AudioWorkletNode;
  analyser: AnalyserNode;
  gain: GainNode;
  row: HTMLLIElement; // sa ligne dans le panneau
  meter: HTMLSpanElement;
  checkbox: HTMLInputElement;
  status: HTMLSpanElement;
}

export class StreamAudioMixer {
  private readonly context = new AudioContext({ sampleRate: 48000 });
  private readonly master = this.context.createGain();
  private readonly destination = this.context.createMediaStreamDestination();
  private readonly channels = new Map<number, Channel>();
  private readonly levelBuffer = new Float32Array(1024);
  /** Appelé quand la liste ou les cases changent (pour le résumé affiché quand le panneau est réduit). */
  onChange: (() => void) | null = null;

  private constructor(
    private readonly app: AudioCaptureApi,
    private readonly list: HTMLUListElement,
    private readonly emptyNote: HTMLElement,
  ) {}

  /** Crée le mélangeur et branche le panneau du son. */
  static async create(app: AudioCaptureApi, panel: HTMLElement): Promise<StreamAudioMixer> {
    const mixer = new StreamAudioMixer(
      app,
      panel.querySelector<HTMLUListElement>("#audio-list")!,
      panel.querySelector<HTMLElement>("#audio-empty")!,
    );
    await mixer.context.audioWorklet.addModule("pcm-worklet.js");
    mixer.master.connect(mixer.destination);
    // Indice pour l'encodeur Opus : c'est de la musique / du son de jeu, pas une voix
    mixer.track.contentHint = "music";

    // Volume général du stream
    const masterInput = panel.querySelector<HTMLInputElement>("#audio-master")!;
    const masterLabel = panel.querySelector<HTMLElement>("#audio-master-value")!;
    const savedMaster = loadJson<number>("umastream.audio.master");
    mixer.master.gain.value = typeof savedMaster === "number" ? savedMaster : 1;
    masterInput.value = String(Math.round(mixer.master.gain.value * 100));
    masterLabel.textContent = `${masterInput.value} %`;
    masterInput.addEventListener("input", () => {
      mixer.master.gain.value = Number(masterInput.value) / 100;
      masterLabel.textContent = `${masterInput.value} %`;
      saveJson("umastream.audio.master", mixer.master.gain.value);
    });

    // Son reçu de umastream-audio -> lecteur de l'application correspondante
    app.onAudioData((pid, samples) => {
      const channel = mixer.channels.get(pid);
      if (!channel) return;
      // On copie dans un tampon neuf, transféré (pas recopié) au fil audio du lecteur
      const copy = samples.slice().buffer;
      channel.player.port.postMessage(copy, [copy]);
    });
    app.onAudioEnded((pid, error) => {
      const channel = mixer.channels.get(pid);
      if (!channel) return;
      channel.capturing = false;
      channel.error = error;
      mixer.updateRow(channel);
    });

    await mixer.refresh();
    setInterval(() => void mixer.refresh(), 2000); // nouvelles applis, applis fermées
    setInterval(() => mixer.updateMeters(), 100);
    return mixer;
  }

  /** Nombre d'applications envoyées dans le stream, sur le nombre d'applications listées. */
  summary(): { sent: number; total: number } {
    let sent = 0;
    for (const channel of this.channels.values()) if (channel.checked) sent++;
    return { sent, total: this.channels.size };
  }

  /** Piste audio du stream (le mélange). Le streamer en ajoute une copie à chaque capture d'écran. */
  get track(): MediaStreamTrack {
    return this.destination.stream.getAudioTracks()[0]!;
  }

  /** Met la liste à jour : ajoute les nouvelles applications, retire celles qui sont fermées. */
  async refresh() {
    let apps: AudioApp[];
    try {
      apps = await this.app.listAudioApps();
    } catch {
      return; // échec ponctuel : on réessaiera dans 2 s
    }
    const seen = new Set<number>();
    for (const app of apps) {
      seen.add(app.pid);
      const channel = this.channels.get(app.pid);
      if (channel) {
        channel.app = app;
        this.updateRow(channel);
      } else {
        this.addChannel(app);
      }
    }
    for (const [pid, channel] of this.channels) {
      if (!seen.has(pid)) this.removeChannel(channel);
    }
    this.sortRows();
    // Capture des applications cochées (relancée si elle s'est arrêtée sans erreur)
    for (const channel of this.channels.values()) {
      if (channel.checked && !channel.capturing && !channel.error) void this.startCapture(channel);
    }
    this.emptyNote.hidden = this.channels.size > 0;
    this.onChange?.();
  }

  private addChannel(app: AudioApp) {
    // Réglages retenus pour cette application. Sinon : cochée seulement si elle joue du son en ce moment
    // et que ce n'est pas une appli de vocal. Une appli silencieuse (notifications, sonneries…) n'est
    // donc jamais envoyée dans le stream sans que le streamer l'ait choisie.
    const pref = loadJson<AppPref>(prefKey(app.exe));
    const checked = pref ? pref.checked : app.active && !isVoiceApp(app.exe);
    const volume = pref ? pref.volume : 1;

    const player = new AudioWorkletNode(this.context, "pcm-player", { outputChannelCount: [2] });
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 1024;
    const gain = this.context.createGain();
    gain.gain.value = checked ? volume : 0;
    player.connect(analyser).connect(gain).connect(this.master);

    // Sa ligne dans le panneau (textContent partout : un nom d'appli ne peut pas injecter de HTML)
    const row = document.createElement("li");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.title = "Envoyer le son de cette application dans le stream";
    const name = document.createElement("span");
    name.className = "audio-name";
    name.textContent = friendlyName(app.exe);
    name.title = app.exe;
    if (isVoiceApp(app.exe)) {
      const tag = document.createElement("span");
      tag.className = "audio-tag";
      tag.textContent = "🎙️ vocal";
      tag.title = "Application de vocal : décochée par défaut pour éviter l'écho chez tes spectateurs";
      name.append(" ", tag);
    }
    const meter = document.createElement("span");
    meter.className = "audio-meter";
    meter.append(document.createElement("span"));
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(Math.round(volume * 100));
    slider.title = "Volume dans le stream";
    const value = document.createElement("span");
    value.className = "audio-value";
    value.textContent = `${slider.value} %`;
    const status = document.createElement("span");
    status.className = "audio-status";
    row.append(checkbox, name, meter, slider, value, status);
    this.list.append(row);

    const channel: Channel = {
      app, checked, volume, capturing: false, error: null,
      player, analyser, gain, row, meter, checkbox, status,
    };
    this.channels.set(app.pid, channel);

    checkbox.addEventListener("change", () => {
      channel.checked = checkbox.checked;
      channel.error = null; // recocher = réessayer
      gain.gain.value = channel.checked ? channel.volume : 0;
      this.savePref(channel);
      if (channel.checked) void this.startCapture(channel);
      else void this.stopCapture(channel);
      this.updateRow(channel);
      this.onChange?.();
    });
    slider.addEventListener("input", () => {
      channel.volume = Number(slider.value) / 100;
      value.textContent = `${slider.value} %`;
      if (channel.checked) gain.gain.value = channel.volume;
      this.savePref(channel);
    });
    this.updateRow(channel);
  }

  /** Ordre du panneau : les applis qui jouent du son d'abord, puis par nom. */
  private sortRows() {
    const sorted = [...this.channels.values()].sort(
      (a, b) =>
        Number(b.app.active) - Number(a.app.active) ||
        friendlyName(a.app.exe).localeCompare(friendlyName(b.app.exe), "fr", { sensitivity: "base" }),
    );
    // insertBefore() déplace une ligne déjà présente : seules celles qui ne sont pas à leur place bougent
    sorted.forEach((channel, i) => {
      if (this.list.children[i] !== channel.row) this.list.insertBefore(channel.row, this.list.children[i] ?? null);
    });
  }

  private removeChannel(channel: Channel) {
    void this.stopCapture(channel);
    channel.player.disconnect();
    channel.analyser.disconnect();
    channel.gain.disconnect();
    channel.row.remove();
    this.channels.delete(channel.app.pid);
  }

  private async startCapture(channel: Channel) {
    if (channel.capturing) return;
    channel.capturing = true;
    try {
      await this.app.startAudioCapture(channel.app.pid);
    } catch (err) {
      channel.capturing = false;
      channel.error = String(err);
    }
    this.updateRow(channel);
  }

  private async stopCapture(channel: Channel) {
    channel.capturing = false;
    await this.app.stopAudioCapture(channel.app.pid);
  }

  private savePref(channel: Channel) {
    saveJson(prefKey(channel.app.exe), { checked: channel.checked, volume: channel.volume } satisfies AppPref);
  }

  private updateRow(channel: Channel) {
    channel.row.classList.toggle("is-off", !channel.checked);
    channel.status.textContent = channel.error ? "⚠️" : "";
    channel.status.title = channel.error ? `Capture impossible : ${channel.error}` : "";
  }

  /** Indicateurs de niveau : le son que produit l'application, avant le réglage de volume. */
  private updateMeters() {
    for (const channel of this.channels.values()) {
      channel.analyser.getFloatTimeDomainData(this.levelBuffer);
      let sum = 0;
      for (const v of this.levelBuffer) sum += v * v;
      const rms = Math.sqrt(sum / this.levelBuffer.length);
      // Échelle "à l'oreille" : -50 dB = vide, 0 dB = plein
      const db = 20 * Math.log10(rms || 1e-6);
      const level = Math.max(0, Math.min(1, (db + 50) / 50));
      (channel.meter.firstElementChild as HTMLElement).style.width = `${Math.round(level * 100)}%`;
    }
  }
}

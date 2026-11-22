// Les connexions vidéo du streamer : une RTCPeerConnection par spectateur accepté.
//
// Cette classe s'occupe UNIQUEMENT de WebRTC côté streamer : créer la connexion et l'offre,
// envoyer ou couper l'image (pause, aveugle), appliquer la qualité de chaque spectateur, relancer
// une connexion qui décroche. Elle ne touche pas à la page : elle prévient juste avec onChange.

import type { SignalData, ViewerQuality } from "../../shared/messages.js";
import type { SendMessage } from "../core/signaling.js";
import { VIEWER_PRESETS, type StreamQuality } from "../core/quality.js";
import { AUDIO_BITRATE, RTC_CONFIG, applySignal, highQualityOpus } from "../core/webrtc.js";

/** Ce qu'il faut savoir de la capture : les pistes à envoyer (elles changent avec l'écran). */
export interface TrackSource {
  readonly videoTrack: MediaStreamTrack;
  readonly audioTrack: MediaStreamTrack | null;
}

interface ViewerPeer {
  pc: RTCPeerConnection;
  name: string;
  // Qualité demandée : à réappliquer quand on change d'écran (pas forcément la même résolution)
  quality: ViewerQuality;
  blind: boolean; // ne reçoit plus ni image ni son
}

/** Ce que le panneau des spectateurs affiche. */
export interface ViewerSummary {
  id: string;
  name: string;
  blind: boolean;
}

export class ViewerPeers {
  private readonly peers = new Map<string, ViewerPeer>();
  // Pause : la capture continue sur ce PC, mais plus rien n'est envoyé aux spectateurs
  private paused = false;
  // Flux "étiquette" commun à la vidéo et au son : côté spectateur, les deux pistes arrivent
  // ainsi dans le MÊME MediaStream (celui affiché par <video>), même après un changement d'écran.
  private readonly outStream = new MediaStream();
  private readonly lastIceRestart = new WeakMap<RTCPeerConnection, number>();

  /** Appelé quand la liste des spectateurs ou leur état change (pour mettre la page à jour). */
  onChange: () => void = () => {};

  constructor(
    private readonly send: SendMessage,
    private readonly tracks: TrackSource,
    private readonly quality: () => StreamQuality,
  ) {}

  get size() {
    return this.peers.size;
  }
  get isPaused() {
    return this.paused;
  }

  list(): ViewerSummary[] {
    return [...this.peers].map(([id, peer]) => ({ id, name: peer.name, blind: peer.blind }));
  }

  *connections(): Iterable<[string, RTCPeerConnection]> {
    for (const [id, peer] of this.peers) yield [id, peer.pc];
  }

  /** Un spectateur arrive (accepté) : on crée une connexion WebRTC dédiée et on lui fait une offre. */
  async add(viewerId: string, name: string) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.peers.set(viewerId, { pc, name, quality: "max", blind: false });
    this.onChange();

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({ type: "signal", to: viewerId, data: { kind: "ice", candidate: e.candidate.toJSON() } });
      }
    };
    // La connexion vidéo décroche (changement de réseau, grosses pertes de paquets…) :
    // "disconnected" se rétablit souvent tout seul, on attend donc 4 s ; "failed" ne se rétablit
    // jamais seul : on relance tout de suite (ICE restart)
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") void this.restartIce(viewerId, pc);
      else if (pc.connectionState === "disconnected") {
        setTimeout(() => {
          if (pc.connectionState === "disconnected") void this.restartIce(viewerId, pc);
        }, 4000);
      }
    };

    const quality = this.quality();
    // sendEncodings permet de fixer le débit max : c'est ce qui fait la différence de qualité.
    // En pause, on réserve l'emplacement ("video" = vide) sans rien envoyer : la reprise le remplira.
    pc.addTransceiver(this.paused ? "video" : this.tracks.videoTrack, {
      direction: "sendonly",
      streams: [this.outStream],
      sendEncodings: [{ maxBitrate: quality.bitrate, maxFramerate: quality.fps }],
    });
    // Emplacement audio TOUJOURS réservé, même si l'écran actuel n'a pas de son ("audio" = vide).
    // replaceTrack() ne peut remplir qu'un emplacement qui existe déjà : sans ça, passer d'une
    // fenêtre muette à un onglet avec du son obligerait à renégocier la connexion.
    const audioTrack = this.tracks.audioTrack;
    pc.addTransceiver(!this.paused && audioTrack ? audioTrack : "audio", {
      direction: "sendonly",
      streams: [this.outStream],
      sendEncodings: [{ maxBitrate: AUDIO_BITRATE }], // son haute qualité (voir highQualityOpus)
    });

    await this.sendOffer(viewerId, pc);
    // Arrivé pendant une pause : on le lui dit tout de suite (sinon il attendrait l'image sans savoir pourquoi)
    if (this.paused) this.send({ type: "signal", to: viewerId, data: { kind: "pause", paused: true } });
  }

  /** Le spectateur est parti (ou a été expulsé). */
  remove(viewerId: string) {
    this.peers.get(viewerId)?.pc.close();
    this.peers.delete(viewerId);
    this.onChange();
  }

  /** Un message WebRTC d'un spectateur (réponse, candidat ICE, qualité voulue, demande de relance). */
  async handleSignal(from: string, data: SignalData) {
    const peer = this.peers.get(from);
    if (!peer) return;
    if (data.kind === "quality") {
      peer.quality = data.preset;
      await this.applyQuality(peer);
    } else if (data.kind === "restart-ice") {
      // Le spectateur nous signale que sa vidéo a décroché (par ex. après une reconnexion)
      void this.restartIce(from, peer.pc);
    } else {
      await applySignal(peer.pc, data);
    }
  }

  /**
   * Pause sans couper le stream : même salon, même lien, connexions toujours ouvertes.
   * Chez le spectateur, la dernière image reste figée avec un bandeau "Stream en pause".
   */
  async setPaused(paused: boolean) {
    this.paused = paused;
    for (const [viewerId, peer] of this.peers) {
      await this.updateSending(peer); // un spectateur aveugle reste aveugle à la reprise
      // À la reprise, l'écran ou la qualité ont pu changer pendant la pause : on réapplique
      if (!paused) await this.applyQuality(peer);
      this.send({ type: "signal", to: viewerId, data: { kind: "pause", paused } });
    }
  }

  /** Rend un spectateur aveugle (plus d'image ni de son, pour lui seul), ou lui rend la vue. */
  async toggleBlind(viewerId: string) {
    const peer = this.peers.get(viewerId);
    if (!peer) return;
    peer.blind = !peer.blind;
    this.onChange();
    await this.updateSending(peer);
    if (!peer.blind) await this.applyQuality(peer);
    this.send({ type: "signal", to: viewerId, data: { kind: "blind", blinded: peer.blind } });
  }

  /**
   * Après un changement d'écran : on envoie les nouvelles pistes à tout le monde, sans renégocier
   * (le spectateur voit juste l'image changer), et on recalcule la qualité de chacun (la résolution
   * du nouvel écran peut être différente).
   */
  async useNewTracks() {
    for (const peer of this.peers.values()) {
      await this.updateSending(peer);
      await this.applyQuality(peer);
    }
  }

  /**
   * Après un changement de qualité du streamer (nouveau débit, nouvelle résolution source) : on
   * réapplique la qualité choisie par CHAQUE spectateur (un spectateur en 1080p redescend en 720p
   * si le streamer passe en 720p, et remonte ensuite).
   */
  async reapplyQualities() {
    for (const peer of this.peers.values()) await this.applyQuality(peer);
  }

  closeAll() {
    for (const peer of this.peers.values()) peer.pc.close();
  }

  private async sendOffer(viewerId: string, pc: RTCPeerConnection, options?: RTCOfferOptions) {
    const offer = await pc.createOffer(options);
    const offerSdp = highQualityOpus(offer.sdp!);
    await pc.setLocalDescription({ type: "offer", sdp: offerSdp });
    this.send({ type: "signal", to: viewerId, data: { kind: "offer", sdp: offerSdp } });
  }

  /**
   * Relance la connexion vidéo d'un spectateur sans la recréer ("ICE restart") : une nouvelle offre
   * avec iceRestart: true fait rechercher aux deux navigateurs un nouveau chemin réseau entre eux,
   * sur la MÊME connexion (pistes, qualité, pause… sont conservées).
   */
  private async restartIce(viewerId: string, pc: RTCPeerConnection) {
    if (pc.connectionState === "closed" || pc.signalingState !== "stable") return; // négociation déjà en cours
    const now = Date.now();
    if (now - (this.lastIceRestart.get(pc) ?? 0) < 3000) return; // pas plus d'une relance toutes les 3 s
    this.lastIceRestart.set(pc, now);
    console.log(`Relance de la connexion vidéo du spectateur ${viewerId} (état : ${pc.connectionState})`);
    await this.sendOffer(viewerId, pc, { iceRestart: true });
  }

  /**
   * Envoie (ou coupe) l'image et le son vers UN spectateur, selon l'état actuel :
   * rien n'est envoyé si le stream est en pause OU si ce spectateur est rendu aveugle.
   * replaceTrack(null) coupe l'envoi sans fermer la connexion, replaceTrack(piste) le relance.
   */
  private async updateSending(peer: ViewerPeer) {
    const sending = !this.paused && !peer.blind;
    for (const transceiver of peer.pc.getTransceivers()) {
      // receiver.track existe toujours (même si sender.track est vide) : il donne le type d'emplacement
      const kind = transceiver.receiver.track.kind;
      await transceiver.sender.replaceTrack(
        sending ? (kind === "video" ? this.tracks.videoTrack : this.tracks.audioTrack) : null,
      );
    }
  }

  /**
   * Applique la qualité demandée par UN spectateur, sur SA connexion uniquement.
   * setParameters() change l'encodage à chaud : pas de renégociation, pas de coupure.
   */
  private async applyQuality(peer: ViewerPeer) {
    // On cherche l'emplacement vidéo par son TYPE (receiver.track existe toujours), pas par sa piste :
    // pendant une pause, sender.track vaut null, et le réglage serait sinon perdu.
    const sender = peer.pc.getTransceivers().find((t) => t.receiver.track.kind === "video")?.sender;
    if (!sender) return;
    const params = sender.getParameters();
    const encoding = params.encodings[0];
    if (!encoding) return; // pas encore négocié

    const quality = this.quality();
    const target = VIEWER_PRESETS[peer.quality];
    const sourceHeight = this.tracks.videoTrack.getSettings().height ?? 1080;
    // scaleResolutionDownBy = "divise la résolution par…" : 1080 / 720 = 1,5 -> 720p.
    // Math.max(1, …) : on ne grossit jamais l'image au-delà de ce que capture le streamer.
    encoding.scaleResolutionDownBy = target ? Math.max(1, sourceHeight / target.height) : 1;
    encoding.maxBitrate = target ? Math.min(quality.bitrate, target.bitrate) : quality.bitrate;
    // Les fps du streamer peuvent changer en direct : on met aussi à jour le plafond d'images/s
    encoding.maxFramerate = quality.fps;
    await sender.setParameters(params);
  }
}

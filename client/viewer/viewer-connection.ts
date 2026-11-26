// Connexion vidéo du spectateur avec le streamer (une seule RTCPeerConnection), et ce qu'on fait
// quand elle décroche : demander au streamer de la relancer (ICE restart).

import type { SignalData } from "../../shared/messages.js";
import { currentStatus, setStatus } from "../core/dom.js";
import type { SendMessage } from "../core/signaling.js";
import { RTC_CONFIG, applySignal, highQualityOpus } from "../core/webrtc.js";

export class ViewerConnection {
  private pc: RTCPeerConnection | null = null;
  private restartRequests = 0;

  constructor(
    private readonly send: SendMessage,
    /** Appelé quand le flux du streamer arrive (image + son). */
    private readonly onStream: (stream: MediaStream) => void,
  ) {}

  /** La connexion existe (même si elle a décroché). */
  get exists() {
    return this.pc !== null;
  }

  /** La connexion n'est ni établie ni en train de s'établir : elle a décroché. */
  get isDown() {
    return this.pc !== null && this.pc.connectionState !== "connected" && this.pc.connectionState !== "connecting";
  }

  /**
   * Le streamer nous fait une offre. Première offre : on crée notre connexion vidéo.
   * Offre suivante (relance de la vidéo, "ICE restart") : on la renégocie sur la MÊME connexion.
   * Renvoie la connexion si elle vient d'être créée, sinon null.
   */
  async handleOffer(sdp: string): Promise<RTCPeerConnection | null> {
    const isNew = !this.pc || this.pc.connectionState === "closed";
    if (isNew) this.pc = this.create();
    const pc = this.pc!;
    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    // Le spectateur indique lui aussi qu'il accepte la stéréo haute qualité (sinon : mono)
    const answerSdp = highQualityOpus(answer.sdp!);
    await pc.setLocalDescription({ type: "answer", sdp: answerSdp });
    this.send({ type: "signal", to: "streamer", data: { kind: "answer", sdp: answerSdp } });
    return isNew ? pc : null;
  }

  /** Candidat ICE (ou réponse) du streamer. */
  async applySignal(data: SignalData) {
    if (this.pc) await applySignal(this.pc, data);
  }

  /** Relance de la vidéo : demander au streamer de renégocier notre connexion (ICE restart). */
  requestIceRestart() {
    this.restartRequests++;
    this.send({ type: "signal", to: "streamer", data: { kind: "restart-ice" } });
  }

  /** Ferme la connexion (elle sera recréée à la prochaine offre). */
  close() {
    this.pc?.close();
  }

  /** Ferme et oublie la connexion. */
  reset() {
    this.close();
    this.pc = null;
  }

  private create(): RTCPeerConnection {
    const connection = new RTCPeerConnection(RTC_CONFIG);
    connection.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({ type: "signal", to: "streamer", data: { kind: "ice", candidate: e.candidate.toJSON() } });
      }
    };
    connection.ontrack = (e) => {
      this.onStream(e.streams[0]!);
      setStatus("");
    };
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (state === "connected") {
        this.restartRequests = 0;
        if (/vidéo/.test(currentStatus())) setStatus("");
      } else if (state === "disconnected") {
        // Souvent passager (quelques paquets perdus) : WebRTC se rétablit souvent tout seul
        setStatus("⚠️ Connexion vidéo instable…", true);
      } else if (state === "failed") {
        // La connexion vidéo a décroché : on demande au streamer de la relancer (ICE restart)
        if (this.restartRequests < 3) {
          setStatus("⚠️ Connexion vidéo perdue, relance en cours…", true);
          this.requestIceRestart();
        } else {
          setStatus("Impossible de rétablir la connexion directe (réseau trop restrictif ?).", true);
        }
      }
    };
    return connection;
  }
}

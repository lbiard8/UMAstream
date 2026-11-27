// Mode spectateur : URL avec ?room=xxxx -> on rejoint le salon et on affiche la vidéo.
//
// « Chef d'orchestre » du spectateur : il relie les morceaux qui ont chacun UN rôle :
//   JoinForm          le formulaire pseudo + mot de passe
//   Player            la vidéo, le son, le bandeau pause / aveugle
//   ViewerConnection  la connexion vidéo avec le streamer (et sa relance)
//   options-panel     le panneau Options (qualité, stats), affiché seulement dans un salon
//   Notice            la carte « impasse » (salon introuvable, stream terminé)
//   SignalingClient   la connexion au serveur, avec reconnexion automatique

import type { ViewerQuality } from "../../shared/messages.js";
import { $, currentStatus, setStatus } from "../core/dom.js";
import { SignalingClient, type SendMessage } from "../core/signaling.js";
import { JoinForm } from "./join-form.js";
import { Notice } from "./notice.js";
import { setupOptionsPanel } from "./options-panel.js";
import { Player } from "./player.js";
import { startStats } from "./stats.js";
import { ViewerConnection } from "./viewer-connection.js";

export function startViewerMode(roomId: string) {
  $("viewer-view").hidden = false;

  const send: SendMessage = (msg) => signaling.send(msg);
  const sendQuality = (preset: ViewerQuality) =>
    send({ type: "signal", to: "streamer", data: { kind: "quality", preset } });

  const player = new Player();
  const connection = new ViewerConnection(send, (stream) => player.attach(stream));
  const form = new JoinForm((name, password) => send({ type: "join-room", roomId, password, name }));
  const notice = new Notice();
  // Le bouton Options ne sert qu'une fois dans le salon (rien à régler avant)
  const showOptions = (visible: boolean) => ($("viewer-options").hidden = !visible);
  let quality = setupOptionsPanel((preset) => {
    // Changement de qualité : on prévient le streamer tout de suite
    quality = preset;
    if (connection.exists) sendQuality(preset);
  });

  // Jeton secret reçu une fois accepté par le streamer : il permet de revenir sans mot de passe
  let resumeToken: string | null = null;

  setStatus("Connexion au salon…");

  // Connexion au serveur, avec reconnexion automatique.
  // Si la connexion au serveur se coupe (Wi-Fi qui saute, relais qui coupe…), on se reconnecte tout
  // seul. Une fois accepté, on revient avec son jeton secret ("resume") : le serveur nous a gardé
  // notre place 30 s, sans mot de passe ni salle d'attente, et la vidéo (en direct) n'est pas coupée.
  const signaling: SignalingClient = new SignalingClient({
    reconnect: true,
    onOpen: () => {
      // Déjà accepté : on reprend notre place avec le jeton. Sinon : 1er contact sans mot de passe
      // (le serveur répond "password-required" si le salon existe).
      if (resumeToken) send({ type: "resume", roomId, resumeToken });
      else send({ type: "join-room", roomId });
    },
    onLost: () =>
      setStatus(
        resumeToken
          ? "Connexion au serveur perdue, reconnexion… (la vidéo continue si elle passe encore)"
          : "Connexion au serveur perdue, reconnexion…",
        true,
      ),
    handlers: {
      "password-required": () => form.show(),
      "password-wrong": (msg) => form.wrongPassword(msg.attemptsLeft),
      // Bloqué pour cette adresse IP : le serveur coupe la connexion, inutile de revenir
      blocked: (msg) => {
        form.blocked(msg.reason, msg.retryAfterSeconds);
        signaling.stopReconnecting();
      },
      // Bon mot de passe : on attend que le streamer clique sur Accepter
      "waiting-approval": () => {
        form.hide();
        setStatus("En attente de l'accord du streamer…");
      },
      "join-refused": () => {
        form.lock();
        setStatus("Le streamer a refusé ta demande.", true);
        signaling.stopReconnecting();
      },
      kicked: () => {
        connection.close();
        player.hide();
        showOptions(false);
        setStatus("Tu as été expulsé du stream.", true);
        signaling.stopReconnecting();
      },
      // Accepté par le streamer : on cache le formulaire et on affiche le lecteur
      joined: (msg) => {
        resumeToken = msg.resumeToken;
        form.hide();
        player.show();
        showOptions(true);
        setStatus("En attente du flux vidéo…");
      },
      // Reconnecté au serveur : on a retrouvé notre place. Si la vidéo a décroché entre-temps,
      // on demande au streamer de la relancer.
      resumed: () => {
        setStatus("Reconnecté.");
        setTimeout(() => {
          if (currentStatus() === "Reconnecté.") setStatus("");
        }, 3000);
        if (connection.isDown) connection.requestIceRestart();
      },
      // Trop tard (plus de 30 s) ou stream terminé : on repart de zéro (mot de passe, salle d'attente)
      "resume-failed": () => {
        resumeToken = null;
        connection.reset();
        player.hide();
        showOptions(false);
        form.reconnectionTooLate();
        send({ type: "join-room", roomId });
      },
      signal: async (msg) => {
        const data = msg.data;
        if (data.kind === "offer") {
          const created = await connection.handleOffer(data.sdp);
          if (created) {
            // Juste après la réponse : on annonce la qualité voulue (le streamer l'applique
            // dès qu'il a traité la réponse, les messages arrivant dans l'ordre)
            sendQuality(quality);
            startStats(created);
          }
        } else if (data.kind === "pause") {
          player.setPaused(data.paused);
          if (data.paused) setStatus("");
        } else if (data.kind === "blind") {
          player.setBlinded(data.blinded);
        } else {
          await connection.applySignal(data);
        }
      },
      "stream-ended": () => {
        connection.close();
        player.hide();
        form.hide();
        showOptions(false);
        notice.show(
          "Le stream est terminé",
          "Le streamer a arrêté de partager son écran. S'il relance un stream, il t'enverra un nouveau lien (ou clique sur Réessayer s'il a relancé le même).",
        );
        signaling.stopReconnecting();
      },
      // Lien faux, ou stream terminé : rien à faire ici, sauf demander un nouveau lien
      "room-not-found": () => {
        form.hide();
        notice.show(
          "Ce salon n'existe pas",
          "Le lien est peut-être incomplet, ou le stream est terminé. Demande un nouveau lien au streamer, puis ouvre-le.",
        );
        signaling.stopReconnecting();
      },
      error: (msg) => {
        setStatus(msg.message, true);
        form.allowRetry(); // ex. "Choisis un pseudo" : on peut corriger et réessayer
      },
    },
  });
}

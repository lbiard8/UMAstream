// Code du navigateur (point d'entrée). Deux modes :
//  - streamer   : pas de ?room= dans l'URL -> on capture l'écran et on crée un salon (streamer/)
//  - spectateur : URL avec ?room=xxxx      -> on rejoint le salon et on affiche la vidéo (viewer/)

import { startStreamerMode } from "./streamer/streamer-mode.js";
import { startViewerMode } from "./viewer/viewer-mode.js";

const roomId = new URLSearchParams(location.search).get("room");
if (roomId) startViewerMode(roomId);
// window.umastreamApp : présent seulement dans l'application de bureau (voir shared/app-bridge.ts
// et electron/preload.ts). Dans le navigateur, il vaut undefined et la page fonctionne comme avant.
else startStreamerMode(window.umastreamApp);

# UMAstream — fiche du projet (à lire avant de fouiller le code)

Partage d'écran en haute qualité (jusqu'à la résolution native, 60 fps, son Opus stéréo 128 kb/s) en WebRTC
pair à pair. Le **streamer** utilise l'appli de bureau Windows (Electron) ou la version navigateur ; les
**spectateurs** regardent dans leur navigateur avec un lien + un mot de passe. Pas de serveur central : chacun
fait tourner UMAstream sur son PC, le lien internet passe par un tunnel Cloudflare (`trycloudflare.com`).

Utilisateur : étudiant (BUT info), débutant sur certains sujets → expliquer simplement, en français.
Dépôt : `lbiard8/UMAstream` (public). Release publiée : v0.1.0 (`UMAstream.Setup.0.1.0.exe`).

## Commandes

| Commande | Rôle |
|---|---|
| `npm run app` | Appli de bureau en développement (compile tout + lance Electron) |
| `npm run dist` | Installateur dans `release\` (compile tout, télécharge cloudflared vérifié) |
| `npm run share` / `npm run dev` | Version navigateur, avec / sans tunnel (port 3000) |
| `npm run build:client` · `build:app` · `build:audio` | Compile la page · Electron · le programme Rust |
| `npx tsc` | Vérifie les types (le faire après chaque modification) |

Tests : lancer sur le **port 3001** (`$env:PORT='3001'`) pour ne pas gêner l'appli de l'utilisateur (port 3000).
Appli de test en parallèle de l'appli installée : `npx electron . --remote-debugging-port=9333
"--user-data-dir=$env:TEMP\umastream-test-profile"` (profil séparé, sinon le verrou d'instance unique la ferme),
puis piloter la page par CDP (port 9333). Fausse source d'écran : remplacer `navigator.mediaDevices.getDisplayMedia`
par un `canvas.captureStream()`.

## Architecture

Organisé selon SOLID (refonte du 22/11/2026) : un fichier = un rôle ; les « chefs d'orchestre » (`*-mode.ts`,
`server.ts`, `electron/main.ts`) ne font que brancher les morceaux ; messages traités par une TABLE
`{ type: gestionnaire }` (`shared/dispatch.ts`) au lieu d'un `switch` ; dépendances passées en paramètre.

```
shared/messages.ts       Types des messages WebSocket client <-> serveur (contrat partagé)
shared/dispatch.ts       MessageHandlers + dispatch() : table « type de message -> fonction »
shared/app-bridge.ts     window.umastreamApp, découpé : ScreenSourceApi, AudioCaptureApi, ShellApi (= AppBridge)

server/server.ts         Point d'entrée : branche tout, écoute, tunnel, serverReady (pour l'appli)
server/config.ts         PORT, --tunnel, --open, UMASTREAM_EMBEDDED / _PUBLIC_DIR
server/static-files.ts   Sert public/ (protection "../")
server/signaling.ts      WebSocketServer : plafonds de connexions, ws.on("error") en premier, -> handlers
server/handlers.ts       Un gestionnaire par message (create-room, join-room, join-answer, resume, kick, signal)
                         + limiteurs (essais, refus 5 min, 20 demandes/min)
server/rooms.ts          RoomRegistry : salons, salle d'attente, acceptés, jetons de reprise, grâce 30 s
server/keepalive.ts      Ping 30 s (Cloudflare coupe à ~125 s)
server/client-ip.ts      Vraie IP (cf-connecting-ip si loopback), isFromThisPc
server/send.ts · open-browser.ts · network.ts (IP locale + cloudflared) · password.ts (scrypt) · limits.ts

client/main.ts           Point d'entrée : ?room= -> viewer, sinon streamer
client/core/             dom ($, setStatus) · prefs (localStorage) · quality (résolutions, presets) ·
                         webrtc (RTC_CONFIG, highQualityOpus, applySignal) · signaling (SignalingClient :
                         file d'attente, envoi protégé, reconnexion 1/2/4/5 s) · errors (ShareError)
client/streamer/         streamer-mode (orchestre) · screen-capture (CaptureSource navigateur | appli, ScreenCapture :
                         changer d'écran / qualité) · viewer-peers (ViewerPeers : 1 RTCPeerConnection par
                         spectateur, pause, aveugle, qualité, ICE restart) · waiting-room · people-panel (affichage
                         seul) · live-panel (lien, pause) · quality-menus · audio-panel (appli) · diagnostics
client/viewer/           viewer-mode (orchestre) · join-form · player (vidéo, son, bandeau) · viewer-connection
                         (RTCPeerConnection + demandes de relance) · options-panel (⚙️) · stats
client/desktop/          Appli seulement : audio-mixer (mélangeur, AudioWorklet public/pcm-worklet.js) ·
                         screen-picker (fenêtre de choix d'écran)

electron/main.ts         Appli : fenêtre, instance unique, port libre, import de server.js APRÈS les variables d'env
electron/native-helper.ts NativeHelper : lance umastream-audio.exe (list, capture, windows, restore)
electron/screen-sources.ts ScreenSources : liste (+ fenêtres réduites), select, setDisplayMediaRequestHandler
electron/ipc.ts          Relie chaque canal ipcMain au bon service
electron/preload.ts      Pont contextIsolation/sandbox -> window.umastreamApp
native/audio-helper/     umastream-audio.exe (Rust, crates wasapi + windows + sysinfo) :
                         list (sessions audio), capture <pid> (process loopback, f32 48 kHz stéréo sur stdout),
                         windows (fenêtres réduites), restore <hwnd> (rouvre sans focus)
public/                  main-page.html (servie sur "/"), style.css, logo.png, pcm-worklet.js, app.js (généré)
scripts/                 build-app.mjs (esbuild), fetch-cloudflared.ps1, make-icon.ps1, create-shortcut.ps1
UMAstream.cmd            Lanceur de la version navigateur (raccourci « UMAstream (navigateur) »)
```

Flux : streamer `create-room` (localhost uniquement) → spectateur `join-room` + mot de passe + pseudo → salle
d'attente → le streamer accepte → `viewer-joined` → `ViewerPeers.add()` fait l'offre WebRTC → vidéo en direct.
Pause / aveugle → `updateSending()` (`replaceTrack(null)`), qualité par spectateur → `applyQuality()` (`setParameters`).

## Avancement

Fait : #1 #2 (qualités), #3 (icône), #6 (lien internet), #7 (pause), #8 (compteur), #9 (mot de passe),
#11 (Bun : non, gardé Node), #12 (accepter/refuser + panneau spectateurs 👁️/🙈/👢), #15 (qualité en direct),
#16 (changer d'écran), #19 (son par application, appli Electron).

En cours : **#23 déconnexions** — fait, testé et commité sur la branche `feat/23-deconnexions-frequentes` (ping 30 s,
reconnexion par jeton, ICE restart), suivi de la refonte SOLID et de la licence. Reste : version 0.2.0 ? + nouvel
installateur + Release (la première sous licence PolyForm) + fusion dans `main`.

À faire : #4 lien via Discord (idée retenue : webhook qui poste/supprime le lien, pas de bot hébergé),
#5 durée d'hébergement, #10 masquer l'IP (relais TURN ; alternative proposée : avertissement obligatoire),
#20 vocal dans l'appli, #22 son quand quelqu'un demande à entrer, #24 autres plateformes (Mac…).

## Décisions (et pourquoi)

- Pair à pair, sans TURN : gratuit et meilleure qualité ; l'IP du streamer est visible des spectateurs ACCEPTÉS
  (avertissement affiché). Tant qu'un spectateur n'est pas accepté, aucune connexion WebRTC.
- `contentHint = "detail"` : la résolution ne baisse jamais seule (les fps baissent si ça sature).
- 1440p retiré (la capture ne dépasse jamais l'écran) ; Native prend la vraie résolution.
- Son par appli via notre propre exe Rust : les modules npm étaient des binaires invérifiables ou liés à l'ABI Electron.
- Applis de vocal décochées par défaut (Discord…) pour éviter l'écho chez les spectateurs.
- Le son du spectateur démarre activé (le clic « Rejoindre » autorise la lecture avec son).
- Installateur non signé (SmartScreen : « Informations complémentaires → Exécuter quand même »).
- Licence **PolyForm Noncommercial 1.0.0** (`LICENSE.md`, « Required Notice: Copyright (c) 2026 L. Biard ») : usage
  libre sauf commercial. Pas « open source » au sens OSI → pas de signature gratuite type SignPath. Pas de page de
  licence dans l'installateur (choix de l'utilisateur). Licences des composants : `THIRD_PARTY_LICENSES.md` (à mettre
  à jour si on ajoute une dépendance livrée dans l'appli).

## Pièges connus

- **Cloudflare coupe un WebSocket inactif à ~125 s** → le ping 30 s est indispensable (cause de #23).
- En Node, une erreur WebSocket sans écouteur fait planter tout le serveur : `ws.on("error")` en PREMIER.
- Le son par appli exige Windows 11 (process loopback, build 20348+). Viser le processus RACINE (`include_tree`).
- `desktopCapturer` ne propose pas les fenêtres réduites → `umastream-audio windows` / `restore`.
- Chrome n'a une session audio que pendant qu'il joue du son (sinon absent de la liste : normal).
- `.people-empty` sert aussi dans le panneau son : sélectionner `.people-empty[data-for]`.
- PowerShell : noms de variables insensibles à la casse (`$source` = `$Source`).
- Après une fusion sur GitHub, faire `git pull` sur `main` (sinon `main` local en retard).
- Le serveur doit être relancé après une modification (Node ne recharge pas le code) ; l'appli installée doit
  être refaite (`npm run dist` + réinstallation) pour profiter des changements.

## Règles de travail avec l'utilisateur

- Toujours proposer le plan et poser les questions **avant** de modifier (sauf petite demande explicite).
- **Jamais de `git push`** ; ne pas committer sans qu'il le demande ; travailler sur la branche où il se trouve.
- Ne jamais modifier les réglages de sécurité de Windows (pare-feu…) : lui donner la marche à suivre.
- Tenir ce fichier à jour à la fin de chaque tâche importante.

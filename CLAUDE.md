# UMAstream — fiche du projet (à lire avant de fouiller le code)

Partage d'écran en haute qualité (jusqu'à la résolution native, 60 fps, son Opus stéréo 128 kb/s) en WebRTC
pair à pair. Le **streamer** utilise l'appli de bureau (Electron : **Windows, macOS, Linux**) ou la version
navigateur ; les **spectateurs** regardent dans leur navigateur avec un lien + un mot de passe. Pas de serveur
central : chacun fait tourner UMAstream sur son PC, le lien internet passe par un tunnel Cloudflare (`trycloudflare.com`).

Utilisateur : étudiant (BUT info), débutant sur certains sujets → expliquer simplement, en français.
Il a un PC Linux, un pote a un Mac (testeurs réels de ces versions).
Dépôt : `lbiard8/UMAstream` (public). Release publiée : v0.1.0 (Windows seulement). Prochaine : v0.2.0 (3 systèmes).

## Commandes

| Commande | Rôle |
|---|---|
| `npm run app` | Appli de bureau en développement (compile tout + lance Electron) |
| `npm run dist` | Installateur du système courant dans `release/` (compile tout, télécharge cloudflared vérifié) |
| `npm run share` / `npm run dev` | Version navigateur, avec / sans tunnel (port 3000) |
| `npm run build:client` · `build:app` · `build:audio` | Compile la page · Electron · le programme Rust |
| `npm run fetch:cloudflared` | `scripts/fetch-cloudflared.mjs [--os …] [--arch x64\|arm64\|universal] [--force]` |
| `npx tsc` | Vérifie les types (le faire après chaque modification) |

Publication : tag `v*` poussé → `.github/workflows/release.yml` fabrique `.exe` (NSIS), `.dmg` universel,
`.AppImage` et `.deb`, puis crée un BROUILLON de Release (l'utilisateur publie). Lancement manuel possible (Artifacts).

Tests : lancer sur le **port 3001** (`$env:PORT='3001'`) pour ne pas gêner l'appli de l'utilisateur (port 3000).
Appli de test en parallèle de l'appli installée : `npx electron . --remote-debugging-port=9333
"--user-data-dir=$env:TEMP\umastream-test-profile"` (profil séparé, sinon le verrou d'instance unique la ferme),
puis piloter la page par CDP (port 9333). Fausse source d'écran : remplacer `navigator.mediaDevices.getDisplayMedia`
par un `canvas.captureStream()`.
**Linux de test** : distribution WSL `umastream-linux` (Ubuntu 24.04, disque dans `D:\UMAstream\wsl`) avec Rust
(+ cibles macOS pour `cargo check`), Node 22 (`/opt/node`), PulseAudio, sox, Xvfb. Faux son : `pulseaudio` +
`module-null-sink` + `sox … synth sine 440 | pacat`. Pour l'écran, utiliser **WSLg** (`DISPLAY=:0`, `--ozone-platform=x11`),
pas Xvfb (voir pièges). Supprimable : `wsl --unregister umastream-linux`.

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
server/origin.ts         Liste fermée des origines autorisées (localhost, 127.0.0.1, [::1], IP locale, tunnel) : un
                         autre site ouvert dans le navigateur ne peut plus se connecter (sans en-tête Origin = accepté)
server/send.ts · open-browser.ts · network.ts (IP locale + cloudflared) · password.ts (scrypt) · limits.ts

client/main.ts           Point d'entrée : ?room= -> viewer, sinon streamer
client/core/             dom ($, setStatus) · prefs (localStorage) · quality (résolutions, presets) ·
                         icons (icon(), setIconText() -> public/icons.svg) · password-toggle (boutons œil) ·
                         webrtc (RTC_CONFIG, highQualityOpus, applySignal) · signaling (SignalingClient :
                         file d'attente, envoi protégé, reconnexion 1/2/4/5 s) · errors (ShareError)
client/streamer/         streamer-mode (orchestre) · screen-capture (CaptureSource navigateur | appli, ScreenCapture :
                         changer d'écran / qualité) · viewer-peers (ViewerPeers : 1 RTCPeerConnection par
                         spectateur, pause, aveugle, qualité, ICE restart) · waiting-room · people-panel (affichage
                         seul) · live-panel (lien, pause) · quality-menus · audio-panel (appli) · diagnostics
client/viewer/           viewer-mode (orchestre) · join-form · player (vidéo, son, bandeau) · viewer-connection
                         (RTCPeerConnection + demandes de relance) · options-panel (affiché seulement dans un salon) · stats ·
                         notice (carte « salon introuvable » / « stream terminé » + Réessayer)
client/desktop/          Appli seulement : audio-mixer (mélangeur, AudioWorklet public/pcm-worklet.js ; listes des
                         applis de vocal / noms lisibles pour les 3 systèmes) · screen-picker (choix d'écran)

electron/main.ts         Appli : fenêtre, instance unique, port libre, import de server.js APRÈS les variables d'env
electron/platform.ts     SEUL endroit qui connaît Windows / macOS / Linux : suffixe .exe, icône, son par appli possible ?
electron/native-helper.ts NativeHelper : lance umastream-audio (list, capture, windows, restore)
electron/screen-sources.ts ScreenSources : liste (+ fenêtres réduites Windows), select, setDisplayMediaRequestHandler
electron/ipc.ts          Relie chaque canal ipcMain au bon service
electron/preload.ts      Pont contextIsolation/sandbox -> window.umastreamApp
native/audio-helper/     umastream-audio (Rust) : main.rs = les 4 commandes + trait Platform ; common.rs (types JSON,
                         PcmWriter, root_process) ; os_windows.rs (WASAPI process loopback, fenêtres réduites) ;
                         os_macos.rs (Core Audio process taps 14.2+, appareil agrégé privé, rééchantillonnage 48 kHz,
                         regroupement par paquet .app) ; os_linux.rs (libpulse : monitor stream de chaque sink input
                         de l'appli, mélange à l'horloge, nouveaux flux suivis par abonnement)
public/                  main-page.html (servie sur "/"), style.css, logo.png, icons.svg (sprite d'icônes maison,
                         remplace les émojis), pcm-worklet.js, app.js (généré)
assets/                  umastream.ico (Windows), umastream.png 512 px (macOS -> .icns, Linux)
scripts/                 build-app.mjs (esbuild), fetch-cloudflared.mjs (3 systèmes, empreinte GitHub + signature
                         Authenticode / Apple), make-icon.ps1, make-png-icon.ps1, create-shortcut.ps1
.github/workflows/       release.yml (3 installateurs + brouillon de Release)
UMAstream.cmd / .sh      Lanceurs de la version navigateur (Windows / macOS-Linux)
```

Flux : streamer `create-room` (localhost uniquement) → spectateur `join-room` + mot de passe + pseudo → salle
d'attente → le streamer accepte → `viewer-joined` → `ViewerPeers.add()` fait l'offre WebRTC → vidéo en direct.
Pause / aveugle → `updateSending()` (`replaceTrack(null)`), qualité par spectateur → `applyQuality()` (`setParameters`).

## Avancement

Fait : #1 #2 (qualités), #3 (icône), #6 (lien internet), #7 (pause), #8 (compteur), #9 (mot de passe),
#11 (Bun : non, gardé Node), #12 (accepter/refuser + panneau spectateurs 👁️/🙈/👢), #15 (qualité en direct),
#16 (changer d'écran), #19 (son par application, appli Electron).

En cours pour la **v0.2.0** (version déjà passée à 0.2.0). Tout est fusionné dans `main` (PR #28) ; on travaille
maintenant sur `main` :
- **#23 déconnexions** : fait, testé (ping 30 s, reconnexion par jeton, ICE restart) ; refonte SOLID et licence aussi.
- **#27 macOS + Linux** (26/11/2026) : fait. Testé : Windows (installateur, appli, son) ; Linux dans WSL (capture
  par appli isolée et au bon débit, AppImage qui démarre, tunnel, choix d'écran, stream). macOS : compile seulement
  → à tester par le pote. 1er lancement du workflow : macOS et Linux OK (artefacts), Windows en échec sur la
  signature de cloudflared (cause : PSModulePath hérité de PowerShell 7 ; corrigé, actions passées en v7/v8/v3). Linux sur un vrai
  bureau : image de l'écran à vérifier (WSLg donnait un aperçu 0x0).
- **Audit Mac** (claude du pote, 27/11/2026) traité : panneau son (Mac : vraies applis seulement ; partout :
  silencieuses décochées, celles qui jouent en tête), sécurité (origine des WebSockets, filtre de liens exact,
  plus d'`app-update.yml`), accueil (logo, 3 étapes, lien « version navigateur » en bas), carte d'impasse du
  spectateur, finitions (œil mot de passe, FPS, focus, cases 18 px), icônes SVG à la place des émojis.
  Écarté pour plus tard : TURN (#10), signature Apple (99 $/an).
- Reste : relancer le workflow, tests Mac (pote) et Linux (PC de l'utilisateur), tag `v0.2.0`, publication de la
  Release, fermer #23 et #27.

À faire : #4 lien via Discord (idée retenue : webhook qui poste/supprime le lien, pas de bot hébergé),
#5 durée d'hébergement, #10 masquer l'IP (relais TURN ; alternative proposée : avertissement obligatoire),
#20 vocal dans l'appli, #22 son quand quelqu'un demande à entrer, #24 autres appareils, #25 (question : comment est
généré le lien), #26 son réglable par chaque spectateur.

## Décisions (et pourquoi)

- Pair à pair, sans TURN : gratuit et meilleure qualité ; l'IP du streamer est visible des spectateurs ACCEPTÉS
  (avertissement affiché). Tant qu'un spectateur n'est pas accepté, aucune connexion WebRTC.
- `contentHint = "detail"` : la résolution ne baisse jamais seule (les fps baissent si ça sature).
- 1440p retiré (la capture ne dépasse jamais l'écran) ; Native prend la vraie résolution.
- Son par appli via notre propre programme Rust (un fichier par système, mêmes 4 commandes partout) : les modules
  npm étaient des binaires invérifiables ou liés à l'ABI Electron.
- Linux : écoute des flux (monitor stream) plutôt que déplacer l'appli vers un faux périphérique : ce que
  l'utilisateur entend ne change pas. macOS : tap `Unmuted` + `private`.
- Fenêtres réduites proposées seulement sous Windows (ailleurs Electron les voit, ou il faut les rouvrir).
- Applis de vocal décochées par défaut (Discord…) pour éviter l'écho chez les spectateurs ; une appli qui ne joue
  rien quand elle apparaît est décochée aussi (pas de sonnerie / notification envoyée par surprise).
- Origine des WebSockets en liste FERMÉE (pas « même hôte que la requête ») : résiste au DNS rebinding.
- Icônes : sprite SVG dessiné pour le projet (pas de bibliothèque -> pas de licence en plus).
- `"publish": null` dans la config electron-builder : pas de mise à jour automatique, donc pas d'`app-update.yml`.
- Spectateur : message `room-not-found` dédié (au lieu d'un `error` en texte) -> carte avec Réessayer.
- Le son du spectateur démarre activé (le clic « Rejoindre » autorise la lecture avec son).
- Installateurs non signés : Windows (SmartScreen : « Informations complémentaires → Exécuter quand même ») ;
  macOS signature « ad hoc » (`identity: "-"`, pas de notarisation) → « Ouvrir quand même » / `xattr -cr`.
- Mac : `.dmg` **universel** (Intel + Apple Silicon) ; programme natif et cloudflared réunis avec `lipo` dans le
  workflow. Linux : **.deb** (recommandé : s'installe par double-clic, entrée de menu, bac à sable
  Chromium réglé par le paquet ; dépend de libpulse0) + **AppImage** (toutes distributions). Fabrication des 3 par GitHub Actions (un .dmg exige un Mac).
- Licence **PolyForm Noncommercial 1.0.0** (`LICENSE.md`, « Required Notice: Copyright (c) 2026 L. Biard ») : usage
  libre sauf commercial. Pas « open source » au sens OSI → pas de signature gratuite type SignPath. Pas de page de
  licence dans l'installateur (choix de l'utilisateur). Licences des composants : `THIRD_PARTY_LICENSES.md` (à mettre
  à jour si on ajoute une dépendance livrée dans l'appli, par système).

## Pièges connus

- **Cloudflare coupe un WebSocket inactif à ~125 s** → le ping 30 s est indispensable (cause de #23).
- En Node, une erreur WebSocket sans écouteur fait planter tout le serveur : `ws.on("error")` en PREMIER.
- Le son par appli : Windows 11 (build 20348+), macOS 14.2+ (Darwin 23.2), Linux PulseAudio/PipeWire. Viser le
  processus RACINE (Windows/Linux : même nom ; macOS : même paquet `.app`, les « Helper » ont un autre nom).
- `desktopCapturer` ne propose pas les fenêtres réduites sous Windows → `umastream-audio windows` / `restore`.
- Chrome n'a une session audio que pendant qu'il joue du son (sinon absent de la liste : normal).
- `.people-empty` sert aussi dans le panneau son : sélectionner `.people-empty[data-for]`.
- PowerShell : noms de variables insensibles à la casse (`$source` = `$Source`) ; en 5.1, `ConvertFrom-Json` d'un
  tableau donne UN objet (passer par `| ForEach-Object { $_ }` avant `Where-Object`).
- Après une fusion sur GitHub, faire `git pull` sur `main` (sinon `main` local en retard).
- Le serveur doit être relancé après une modification (Node ne recharge pas le code) ; l'appli installée doit
  être refaite (`npm run dist` + réinstallation) pour profiter des changements.
- libpulse : fermer le `Context` AVANT la `Mainloop` (ordre des champs + `Drop`), sinon plantage à la sortie.
- Mélange Linux : l'horloge ne démarre qu'au premier son reçu, sinon un retard d'environ 1 s reste jusqu'au bout.
- cloudflared macOS et Linux ont le même nom de fichier : `vendor/cloudflared.json` dit pour quel système il est.
- Serveurs Windows de GitHub Actions : les étapes tournent dans PowerShell 7 ; un `powershell` (5.1) lancé depuis
  là hérite de `PSModulePath` et ne trouve plus `Get-AuthenticodeSignature` → le lancer SANS `PSModulePath`
  (fait dans `fetch-cloudflared.mjs`). Une tolérance reste en place là-bas si seule la chaîne de certificats ne peut
  pas être vérifiée (signataire Cloudflare exigé, empreinte SHA-256 aussi).
- `D:` est en **exFAT** : pas de liens → rustup et le cache de Cargo n'y marchent pas (tout passe par le Linux WSL,
  dont le disque virtuel est sur D:).
- **Xvfb** : `desktopCapturer.getSources` renvoie souvent une liste vide (faux problème) → tester sur WSLg.
- README en fins de ligne CRLF : un remplacement par script doit en tenir compte.
- Ubuntu récent : le gestionnaire de fichiers ne lance plus un programme (AppImage) par double-clic → d'où le
  `.deb`. Le `.deb` exige `linux.maintainer` (adresse noreply GitHub) et `homepage` dans package.json.
- Git Bash → WSL : préfixer `MSYS_NO_PATHCONV=1` et passer par un script `.sh` (les commandes en ligne se cassent).

## Règles de travail avec l'utilisateur

- Toujours proposer le plan et poser les questions **avant** de modifier (sauf petite demande explicite) ; poser
  les questions avec l'outil de cases à cocher.
- **Jamais de `git push`** ; ne pas committer sans qu'il le demande ; travailler sur la branche où il se trouve.
- Ne jamais modifier les réglages de sécurité de Windows (pare-feu…) : lui donner la marche à suivre.
- Tenir ce fichier à jour à la fin de chaque tâche importante.

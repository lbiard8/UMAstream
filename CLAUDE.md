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

```
shared/messages.ts    Types des messages WebSocket client <-> serveur (contrat partagé)
shared/app-bridge.ts  window.umastreamApp : ce que l'appli de bureau ajoute à la page
server/server.ts      Serveur HTTP (sert public/) + signalisation WebSocket : salons, mot de passe, salle d'attente,
                      expulsion, ping 30 s, période de grâce 30 s + reprise par jeton
server/network.ts     IP locale + tunnel cloudflared (UMASTREAM_CLOUDFLARED = chemin de l'exe fourni par l'appli)
server/password.ts    scrypt + timingSafeEqual, 5 essais/IP puis blocage 5 min, délai 5 min après un refus
server/limits.ts      Plafonds : 10 connexions/IP, 100 au total, 20 demandes/min/IP, 20 en attente/salon
client/main.ts        Toute la page : mode streamer (pas de ?room=) et mode spectateur (?room=xxx)
client/app-audio.ts   Appli : panneau « Son du stream » + mélangeur (AudioWorklet public/pcm-worklet.js)
client/app-picker.ts  Appli : fenêtre de choix d'écran (miniatures, fenêtres réduites rouvertes)
electron/main.ts      Appli : fenêtre, serveur intégré (import de server.js après réglage des variables d'env),
                      choix d'écran (setDisplayMediaRequestHandler), lancement de umastream-audio.exe
electron/preload.ts   Pont contextIsolation/sandbox -> window.umastreamApp
native/audio-helper/  umastream-audio.exe (Rust, crates wasapi + windows + sysinfo) :
                      list (sessions audio), capture <pid> (process loopback, f32 48 kHz stéréo sur stdout),
                      windows (fenêtres réduites), restore <hwnd> (rouvre sans focus)
public/               main-page.html (servie sur "/"), style.css, logo.png, pcm-worklet.js, app.js (généré)
scripts/              build-app.mjs (esbuild), fetch-cloudflared.ps1, make-icon.ps1, create-shortcut.ps1
UMAstream.cmd         Lanceur de la version navigateur (raccourci « UMAstream (navigateur) »)
```

Flux : streamer `create-room` (localhost uniquement) → spectateur `join-room` + mot de passe + pseudo → salle
d'attente → le streamer accepte → `viewer-joined` → le streamer fait l'offre WebRTC (une `RTCPeerConnection` par
spectateur) → vidéo en direct. Envoi par spectateur contrôlé par `updateSending()` (pause / aveugle →
`replaceTrack(null)`), qualité par spectateur par `applyViewerQuality()` (`setParameters`).

## Avancement

Fait : #1 #2 (qualités), #3 (icône), #6 (lien internet), #7 (pause), #8 (compteur), #9 (mot de passe),
#11 (Bun : non, gardé Node), #12 (accepter/refuser + panneau spectateurs 👁️/🙈/👢), #15 (qualité en direct),
#16 (changer d'écran), #19 (son par application, appli Electron).

En cours : **#23 déconnexions** — fait et testé sur la branche `feat/23-deconnexions-frequentes`, **pas encore
commité** (ping 30 s, reconnexion par jeton, ICE restart). Reste : version 0.2.0 ? + nouvel installateur + Release.

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

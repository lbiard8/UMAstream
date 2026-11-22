# UMAstream

Partage ton écran en haute qualité (jusqu'à la résolution native de l'écran, 60 fps), via WebRTC, depuis
l'application UMAstream pour Windows ou directement depuis le navigateur. Pas de compte : tu lances l'appli sur
ton PC, tu envoies le lien et le mot de passe, tes potes regardent dans leur navigateur.

1. [Installation](#1-installation) : à faire une seule fois par PC
2. [Utilisation](#2-utilisation) : streamer, regarder, arrêter
3. [Comment ça marche](#3-comment-ça-marche) : les détails techniques

---

## 1. Installation

À faire **une seule fois** sur chaque PC qui veut streamer (Windows).
Pour **regarder** un stream, il n'y a rien à installer : un navigateur suffit.

Deux façons de streamer :

| | Application UMAstream (recommandée) | Version navigateur |
|---|---|---|
| Installation | Un installateur à [télécharger](https://github.com/lbiard8/UMAstream/releases/latest), rien d'autre | Node.js + cloudflared + le projet |
| **Son par application** (ex. : tout sauf Discord) | ✅ (Windows 11) | ❌ (tout le son du PC, ou un onglet) |

### A. L'application UMAstream (recommandée)

Le tunnel (cloudflared) est inclus dans l'application : il n'y a rien d'autre à installer.

**1. Télécharger l'installateur**

👉 **https://github.com/lbiard8/UMAstream/releases/latest**

Dans la partie **Assets**, clique sur **`UMAstream.Setup.0.1.0.exe`** (environ 130 Mo). Pas besoin de cloner le
dépôt ni d'installer Node.js : l'installateur contient tout.

> Si tu as fabriqué l'installateur toi-même ([voir plus bas](#fabriquer-linstallateur)), il est dans le dossier
> **`release\`** du projet, sous le nom `UMAstream Setup 0.1.0.exe`.

**2. Double-clic sur l'installateur.** Il n'est pas signé, Windows affiche donc un écran bleu
« **Windows a protégé votre ordinateur** » :
1. clique sur le lien **Informations complémentaires** (sous le texte) ;

Cet avertissement n'apparaît qu'à l'installation, pas à chaque lancement.

**3. Suivre l'assistant d'installation**
1. **Pour qui installer** :
   - **Uniquement pour moi** (conseillé) : pas besoin de droits administrateur, l'appli va dans
     `%LOCALAPPDATA%\Programs\UMAstream` ;
   - **Pour tous les utilisateurs** : Windows demande l'autorisation administrateur, l'appli va dans
     `C:\Program Files\UMAstream`.
2. **Dossier d'installation** : garde celui proposé, ou choisis-en un autre.
3. **Installer**, puis **Terminer**. Si la case **Lancer UMAstream** est cochée, l'appli démarre tout de suite.

Une icône **UMAstream** est créée sur le **bureau** et dans le **menu Démarrer**.

**4. Premier lancement**
1. La fenêtre s'ouvre sur « Démarrage d'UMAstream… », puis la page s'affiche (quelques secondes, le temps
   d'ouvrir le lien internet).
2. Windows peut afficher « **Le Pare-feu Windows Defender a bloqué certaines fonctionnalités de cette
   application** » (UMAstream fait tourner un petit serveur). Coche **Réseaux privés**, puis clique sur
   **Autoriser l'accès**. Ce message n'apparaît qu'une fois.
   - Le lien internet (tunnel) fonctionne même sans autoriser les **réseaux publics** (Wi-Fi d'université,
     de gare…). Les autoriser n'est utile que pour le lien « réseau local », et expose le serveur aux autres
     appareils de ce réseau public : mieux vaut ne pas le faire.

C'est prêt : tu peux [streamer ton écran](#streamer-ton-écran).

> **Bon à savoir**
> - **Mettre à jour** : ferme UMAstream, télécharge le nouvel installateur sur la
>   [page des versions](https://github.com/lbiard8/UMAstream/releases/latest) et lance-le : il remplace
>   l'ancienne version (tes réglages sont conservés).
> - **Tester sans installer** : `release\win-unpacked\UMAstream.exe` lance l'appli directement depuis le projet.
> - **Désinstaller** : Paramètres Windows → **Applications** → **UMAstream** → Désinstaller.

### B. La version navigateur (moins fonctionnelle)

**1. Installer Node.js** : télécharge la version **LTS** sur https://nodejs.org et installe-la avec les options
par défaut.

**2. Installer cloudflared** (pour que le lien marche depuis n'importe où) :

```powershell
winget install --id Cloudflare.cloudflared
```

**3. Récupérer le projet** :

```powershell
git clone https://github.com/lbiard8/UMAstream.git
```

(ou sur GitHub : **Code → Download ZIP**, puis extraire le dossier)

**4. Créer l'icône sur le bureau**, depuis le dossier du projet :

```powershell
cd UMAstream
npm run shortcut
```

Une icône **UMAstream (navigateur)** apparaît sur le bureau. Au premier lancement, elle installe d'elle-même ce
qui manque (environ une minute).

> **Pièges possibles**
> - Projet téléchargé en ZIP : au premier double-clic, Windows peut afficher « Windows a protégé votre
>   ordinateur ». Clique sur **Informations complémentaires → Exécuter quand même**.
> - cloudflared installé alors qu'un terminal était ouvert : ferme et rouvre le terminal.
> - Dossier du projet déplacé : relance `npm run shortcut`.

### Fabriquer l'installateur

Pour créer `UMAstream Setup x.y.z.exe` à partir du projet (une fois, sur ton PC de développement) :

1. Installer **Node.js**, **Rust** (https://rustup.rs) et les **outils C++ de Visual Studio**
   (« Développement Desktop en C++ », nécessaires à Rust sous Windows).
2. Dans le dossier du projet :

```powershell
npm install
npm run dist
```

L'installateur est créé dans `release\`. `npm run dist` compile tout (page, application, programme audio),
télécharge `cloudflared.exe` (vérifié : signé par Cloudflare) puis assemble l'installateur.

**Publier une nouvelle version** (pour que les autres la téléchargent) :
1. Change `"version"` dans `package.json` (ex. `0.2.0`), puis lance `npm run dist`.
2. Sur GitHub : **Releases → Draft a new release**, tag `v0.2.0`, et glisse
   `release\UMAstream Setup 0.2.0.exe` dans **Attach binaries** (GitHub remplace les espaces par des points
   dans le nom du fichier).
3. **Publish release**. Le lien [`releases/latest`](https://github.com/lbiard8/UMAstream/releases/latest) pointe
   alors automatiquement vers cette nouvelle version.

Ou en une commande, avec GitHub CLI :

```powershell
gh release create v0.2.0 "release\UMAstream Setup 0.2.0.exe" --title "UMAstream 0.2.0" --notes "…"
```

---

## 2. Utilisation

### Lancer l'appli

- **Application** : double-clic sur l'icône **UMAstream**. La fenêtre s'ouvre tout de suite sur « Démarrage
  d'UMAstream… », puis la page s'affiche une fois le lien internet prêt (quelques secondes). Relancer l'icône
  alors qu'elle est ouverte ramène simplement la fenêtre au premier plan.
  En haut à gauche, **🌐 Aller sur la version navigateur** ouvre la même page dans ton navigateur.
- **Version navigateur** : double-clic sur **UMAstream (navigateur)**. Le navigateur s'ouvre sur
  `http://localhost:3000` ; une fenêtre de terminal s'ouvre aussi, réduite dans la barre des tâches
  (`UMAstream.cmd`, à la racine du projet, fait la même chose).

### Streamer ton écran

1. Choisis la **résolution** et les **fps** (1080p / 60 par défaut).
2. Choisis un **mot de passe** (obligatoire).
3. Clique sur **Partager mon écran** et choisis ce que tu partages :
   - **application** : choisis un écran ou une fenêtre parmi les miniatures. Les fenêtres **réduites** dans la
     barre des tâches apparaissent avec leur icône et la mention « réduite » : UMAstream les rouvre (sans les passer
     devant) pour les partager, car Windows ne peut pas capturer une fenêtre réduite. Le son se règle dans le
     panneau **🔊 Son du stream** (voir ci-dessous) ;
   - **version navigateur** : choisis dans la fenêtre de Chrome. Pour le son, coche « Partager l'audio »
     (écran entier ou onglet seulement : c'est alors tout le son du PC, Discord compris).
4. Clique sur **Copier le lien** et envoie-le à tes potes. Vérifie que la note sous le lien est
   (« 🌍 Lien accessible depuis n'importe où »).
5. Envoie le **mot de passe à part** (en vocal, en message privé), jamais avec le lien.
6. Quand quelqu'un demande à entrer, il apparaît à droite dans **⏳ En attente** : clique sur ✅ pour l'accepter.

### Pendant le stream

| Bouton | Effet |
|---|---|
| Menus **Résolution / Fps** | Changent la qualité en direct, sans couper |
| **⏸ Pause** / **▶ Reprendre** | Fige l'image chez les spectateurs, sans les déconnecter |
| **🔄 Changer d'écran** | Passe à un autre écran ou une autre fenêtre (ou un onglet, dans la version navigateur), sans couper |
| **🔧 Diagnostic** | Affiche ce que l'encodeur envoie vraiment (utile si ça saccade) |
| **Arrêter le partage** | Termine le stream |

Dans le panneau de droite (sous le reste sur petit écran) :

| Liste | Bouton | Effet |
|---|---|---|
| ⏳ En attente | ✅ / ❌ | Accepter / refuser la personne (refusée = 5 minutes avant de pouvoir redemander) |
| 👥 Spectateurs | 👁️ / 🙈 | Il voit / il est aveugle (plus ni image ni son pour lui seul). Un clic inverse |
| 👥 Spectateurs | 👢 | L'expulser (il peut refaire une demande) |
| | ☐ Accepter automatiquement | Toute personne qui a le bon mot de passe entre directement |

### Le son du stream (application, Windows 11)

Le panneau **🔊 Son du stream** liste les applications qui ont du son (comme le mélangeur de volume de Windows).
Il est **réduit par défaut** : son en-tête affiche un résumé (« 2 applis envoyées sur 4 ») et le bouton
**▸ Agrandir / ▾ Réduire** l'ouvre ou le ferme (le choix est retenu).

| Élément | Effet |
|---|---|
| ☑ Case | Envoyer (ou non) le son de cette application à tes spectateurs |
| Barre verte | Le son que produit l'application en ce moment |
| Curseur | Son volume **dans le stream** |
| Volume général | Le volume de tout le son du stream |

- **Ces réglages ne touchent que le stream** : ce que tu entends toi-même ne change pas.
- **Les applis de vocal** (Discord, Teams, TeamSpeak, Zoom…, marquées 🎙️ vocal) sont **décochées par défaut** :
  si tu es en vocal avec tes spectateurs, ils ne s'entendent pas en écho dans le stream.
- Une application lancée pendant le stream apparaît toute seule (cochée, sauf si c'est une appli de vocal).
- Tes choix (case, volume) sont retenus pour chaque application.
- Une application n'apparaît que si elle a une session audio : **Chrome, par exemple, n'est listé que lorsqu'il
  joue (ou vient de jouer) du son**. Lance ta vidéo, il apparaît dans les 2 secondes.

### Regarder un stream

1. Ouvre le lien reçu (ordinateur ou téléphone).
2. Tape ton **pseudo** et le **mot de passe**, puis attends que le streamer t'accepte.
3. **Le son est activé d'office** : le clic sur « Rejoindre » suffit au navigateur pour l'autoriser. Le bouton
   **🔇 Couper le son** le coupe (et **🔊 Activer le son** le remet, si un navigateur strict l'a refusé au départ).
4. **⚙️ Options**, en haut à droite : choisis ta **qualité** (baisse-la si ta connexion rame) et affiche les
   **stats** si tu veux voir la résolution, les fps et le débit reçus (image, et son en 🔊 kb/s).
5. Si ta connexion saute (Wi-Fi, changement de réseau…), **pas besoin de recharger la page** : elle se reconnecte
   toute seule (« ⚠️ Connexion au serveur perdue, reconnexion… » puis « ✅ Reconnecté »), sans retaper le mot de
   passe, tant que la coupure dure moins de 30 secondes. Au-delà, il faut retaper le mot de passe.

### Arrêter l'appli

- **Application** : **ferme sa fenêtre**. Le stream, le serveur, le tunnel et la capture du son s'arrêtent ensemble.
- **Version navigateur** : **ferme la fenêtre du terminal** (ou `Ctrl + C` dedans).

Pense à le faire quand tu ne streames pas.

### Bon à savoir

- **Tes spectateurs acceptés peuvent voir ton adresse IP** (la vidéo passe en direct entre vos PC) :
  !!! ne partage le lien qu'avec des personnes de confiance !!!
- **Le lien change à chaque lancement** de l'appli : renvoie-le à chaque fois.
- **Environ 2 à 4 spectateurs en 1080p**, selon ta connexion montante.
- **Attention à ce que tu montres** : notifications, mots de passe, e-mails… Partage une fenêtre plutôt que
  l'écran entier, active « Ne pas déranger » dans Windows, et utilise ⏸ Pause avant d'ouvrir quelque chose de privé.
- Sur certains réseaux très fermés (école, entreprise, certaines 4G), la vidéo peut ne pas passer.
- Le son par application demande **Windows 11** (ou Windows 10 build 20348+). Sur un Windows plus ancien,
  l'application fonctionne, mais le stream part sans son (le panneau l'indique).

---

## 3. Comment ça marche

### Le principe

1. Le streamer capture son écran (`getDisplayMedia`) et demande un salon au serveur, avec un mot de passe.
2. Un spectateur ouvre le lien `?room=…`, tape son pseudo et le mot de passe ; s'il est bon, le streamer
   reçoit sa demande et l'accepte (ou la refuse).
3. Les deux navigateurs s'échangent offre, réponse et candidats ICE **via le serveur**.
4. Ensuite la vidéo passe **en direct** entre les navigateurs (pair à pair). Le serveur ne voit jamais la vidéo.

### L'application de bureau

L'application (Electron) fait tourner **le même serveur** que `npm run share`, puis affiche **la même page** dans
sa propre fenêtre. Les spectateurs, eux, restent dans leur navigateur. Elle ajoute deux choses :

- **Sa propre fenêtre de choix d'écran** : Electron n'a pas celle de Chrome. La page affiche des miniatures
  (`desktopCapturer`), puis `getDisplayMedia()` capture la source choisie (`setDisplayMediaRequestHandler`).
  Windows ne capture pas une fenêtre réduite, et `desktopCapturer` ne les propose donc pas : `umastream-audio.exe
  windows` liste les fenêtres réduites de la barre des tâches (affichées avec l'icône de leur programme), et
  `umastream-audio.exe restore <hwnd>` rouvre celle qu'on choisit sans lui donner le focus. L'appli attend
  ensuite qu'elle apparaisse dans les sources d'Electron (`window:<hwnd>:…`) pour la capturer.
- **Le son par application**, grâce à `umastream-audio.exe` (`native/audio-helper`, en Rust). Windows sait
  capturer le son d'**un programme et de ses sous-processus** (« process loopback », Windows 11) : chaque
  application cochée a sa propre capture, et la page mélange le tout :

```
umastream-audio.exe capture <pid>   ->  son brut (48 kHz, stéréo, flottants)  ->  processus principal Electron
  ->  page : lecteur AudioWorklet (public/pcm-worklet.js)  ->  volume de l'appli  ->  volume général
  ->  piste audio du stream (MediaStreamAudioDestinationNode)  ->  WebRTC
```

- La page ne parle à Electron qu'à travers `window.umastreamApp` (`shared/app-bridge.ts`, `electron/preload.ts`),
  avec `contextIsolation` et `sandbox` : elle n'a aucun autre accès au PC.
- Le port est choisi automatiquement (3000, ou le suivant s'il est déjà pris, par exemple par la version navigateur).
- Une seule instance à la fois. Fermer la fenêtre arrête tout (serveur, tunnel, captures audio).
- Le son du stream (application **et** version navigateur) part en **Opus stéréo à 128 kb/s** : WebRTC règle
  Opus pour la voix par défaut (mono, ~32 kb/s), on modifie donc le SDP des deux côtés (`highQualityOpus`).

### Commandes

| Commande | Rôle |
|---|---|
| `npm run app` | Compile tout et lance l'application de bureau (développement) |
| `npm run dist` | Compile tout, télécharge cloudflared et fabrique l'installateur dans `release\` |
| `npm run build:app` | Compile l'application Electron dans `dist/` (`scripts/build-app.mjs`) |
| `npm run build:audio` | Compile `umastream-audio.exe` (Rust) |
| `npm run fetch:cloudflared` | Télécharge `vendor/cloudflared.exe` et vérifie sa signature Cloudflare |
| `npm run share` | Version navigateur : compile le client puis lance le serveur sur le port 3000, avec un tunnel Cloudflare (lien valable partout). C'est ce que lance l'icône « UMAstream (navigateur) » |
| `npm run dev` | Pareil sans tunnel (lien valable sur ton réseau local) |
| `npm run build:client` | Compile `client/main.ts` en `public/app.js` (esbuild) |
| `npm run typecheck` | Vérifie les types de tout le projet (TypeScript) |
| `npm run shortcut` | Crée l'icône « UMAstream (navigateur) » sur le bureau (Windows) |
| `npm run icon` | Régénère `assets/umastream.ico` à partir de `public/logo.png` (si tu changes de logo) |

Le lanceur `UMAstream.cmd` vérifie que Node est installé, lance `npm install` si `node_modules` manque, puis
`npm run share -- --open` (`--open` ouvre le navigateur une fois le serveur et le tunnel prêts). Si l'appli tourne
déjà, il ouvre simplement la page existante.

### Le lien partagé et le tunnel

`localhost` ne désigne que ton propre PC : un lien `http://localhost:3000/…` ne marche pas chez un ami.
Le serveur choisit donc lui-même la meilleure adresse pour le lien généré :

| Lancement | Lien généré | Qui peut l'ouvrir |
|---|---|---|
| `npm run share` (cloudflared installé) | `https://xxxx.trycloudflare.com/?room=…` | 🌍 N'importe qui |
| `npm run dev` | `http://<ton IP locale>:3000/?room=…` | 🏠 Les PC sur le même réseau (box, Wi-Fi) |
| Pas de réseau | `http://localhost:3000/?room=…` | 💻 Ce PC seulement |

- L'adresse publique est utilisée pour le lien affiché dans la page (et, dans la version navigateur, s'affiche
  aussi dans le terminal : `Internet : https://…`). Le tunnel est gratuit et sans compte, mais **son adresse
  change à chaque lancement**.
- Le tunnel ne transporte que la page et la signalisation : la vidéo continue de passer en direct entre les PC.
- Sur certains réseaux (Wi-Fi d'université, réseau d'entreprise), les PC ne peuvent pas se joindre entre eux :
  le lien « réseau local » ne marchera pas, utilise `npm run share`.

### Mot de passe

- **Il ne fait jamais partie du lien** : si le lien fuit, le mot de passe ne fuit pas avec.
- **C'est le serveur qui vérifie**, et il ne garde que l'empreinte du mot de passe (`scrypt` + sel aléatoire),
  jamais le mot de passe en clair. La comparaison se fait en temps constant (`timingSafeEqual`).
- **Tant que le mot de passe n'est pas bon, le streamer n'est même pas prévenu** : aucune connexion WebRTC n'est
  lancée, donc un inconnu ne reçoit jamais ton adresse IP (en passant par le tunnel).
- **5 essais maximum par adresse IP**, avec une pause croissante entre chaque essai (0 s, 0,5 s, 1 s…). Après la
  5e erreur, cette IP est bloquée **5 minutes**, même en rechargeant la page. Les autres spectateurs ne sont pas
  touchés. Via le tunnel, l'IP réelle est lue dans l'en-tête `cf-connecting-ip` envoyé par Cloudflare.
- Le mot de passe est fixé pour toute la durée du stream, et il n'est retenu ni par le navigateur du streamer ni
  par celui des spectateurs.

> Deux personnes derrière la même box partagent la même IP : si l'une se trompe 5 fois, l'autre est bloquée aussi.

### Gestion des spectateurs

- Après le bon mot de passe, le spectateur arrive en **salle d'attente**. Tant qu'il n'est pas accepté,
  **aucune connexion WebRTC n'existe** : ni son IP ni la tienne ne sont échangées.
- Une demande sans réponse attend indéfiniment, et disparaît si le spectateur ferme la page.
- Cocher **Accepter automatiquement** accepte aussi ceux qui attendent déjà.
- **Aveugle** : `replaceTrack(null)` sur la connexion de ce spectateur seulement. Il reste connecté et voit un
  bandeau « 🙈 Le streamer a masqué l'image pour toi ».
- **Le pseudo n'est pas vérifié** : n'importe qui peut taper celui d'un pote. En cas de doute, demande-lui en vocal.
- Les pseudos sont affichés avec `textContent`, jamais `innerHTML` : un pseudo comme `<b>gras</b>` s'affiche tel
  quel, sans pouvoir injecter de code chez le streamer.
- Seul le streamer du salon peut accepter, refuser ou expulser : le serveur le vérifie à chaque demande.

### Connexions stables

Un spectateur a **deux connexions** avec le streamer : la **vidéo** (WebRTC, en direct entre les deux PC) et une
connexion de **contrôle** avec le serveur (WebSocket, via le tunnel). Les deux sont protégées contre les coupures :

- **Ping toutes les 30 s.** Une fois la vidéo lancée, la connexion de contrôle ne transporte presque plus rien,
  et le tunnel Cloudflare coupe un WebSocket inactif au bout d'environ 2 minutes (mesuré : 125 s). C'était la
  cause des déconnexions toutes les quelques minutes. Le serveur envoie donc un ping à chaque connexion toutes les
  30 s (le navigateur répond tout seul) ; une connexion qui ne répond plus est fermée proprement.
- **Reconnexion automatique.** Une fois accepté, le spectateur reçoit un **jeton secret de reprise**. Si sa
  connexion de contrôle se coupe quand même, le serveur le garde **30 s** (sans prévenir le streamer) et le
  spectateur se reconnecte tout seul avec son jeton (1 s, 2 s, 4 s, puis toutes les 5 s) : pas de mot de passe,
  pas de salle d'attente, et la vidéo, qui passe en direct, n'est pas coupée. Après 30 s, il est retiré et doit
  retaper le mot de passe. Une **expulsion** (👢) annule le jeton : pas de retour possible par ce biais.
- **Relance de la vidéo (ICE restart).** Si la connexion vidéo décroche (`failed`, ou `disconnected` pendant plus
  de 4 s), le streamer envoie une nouvelle offre avec `iceRestart: true` : les deux navigateurs cherchent un
  nouveau chemin réseau, **sur la même connexion** (qualité, pause, aveugle… sont conservés). Le spectateur peut
  aussi la demander (`restart-ice`), par exemple après une reconnexion, ou jusqu'à 3 fois si elle échoue encore.

### Sécurité

Chacun fait tourner UMAstream sur son PC. Le serveur est exposé à internet (via le tunnel) ou au réseau local :
il est donc conçu pour qu'un inconnu qui a l'adresse ne puisse rien en tirer.

- **Seul ce PC peut streamer** : créer un salon n'est autorisé que depuis `http://localhost`. Via le tunnel ou
  l'IP locale, la page sert seulement à regarder. Un inconnu ne peut donc pas créer de salons sur ton PC.
- **Messages limités à 64 Ko** (au lieu de 100 Mo par défaut) : impossible de remplir la mémoire du PC.
- **Une connexion en erreur ne fait jamais planter le serveur** : seule la connexion fautive est fermée.
- **Plafonds anti-abus** (`server/limits.ts`) :

| Limite | Valeur |
|---|---|
| Connexions ouvertes par IP | 10 |
| Connexions ouvertes au total | 100 |
| Demandes « rejoindre » par IP | 20 par minute |
| Demandes en attente par salon | 20 |

- Le serveur ne sert que le dossier `public/` : aucun accès aux autres fichiers du PC.
- Le tunnel ne redirige que vers le port d'UMAstream : les autres programmes du PC ne sont pas joignables.

**Ce qui reste à savoir :**
- En mode réseau local (`npm run dev`), tout circule **en clair** (`http://`, `ws://`) : sur un Wi-Fi public ou
  d'université, quelqu'un sur le même réseau pourrait lire le mot de passe. Préfère `npm run share` (HTTPS).
- Avec le tunnel, le chiffrement s'arrête chez Cloudflare, qui pourrait techniquement lire la signalisation
  (dont le mot de passe). La vidéo, elle, ne passe jamais par Cloudflare.

### Qualité côté streamer

Le streamer choisit une **résolution** (Native, 1080p, 720p, 480p, 360p) et un nombre d'**images par seconde**
(60 ou 30). Le choix est retenu par le navigateur (par défaut : 1080p, 60 fps). Le débit max envoyé à chaque
spectateur en découle :

| Résolution | 30 fps | 60 fps |
|---|---|---|
| Native (ex. 4K) | 14 Mb/s | 20 Mb/s |
| 1080p | 6 Mb/s | 9 Mb/s |
| 720p | 3 Mb/s | 4,5 Mb/s |
| 480p | 1,5 Mb/s | 2,2 Mb/s |
| 360p | 0,8 Mb/s | 1,2 Mb/s |

- 60 fps = 2× plus d'images, mais elles se ressemblent et se compressent mieux : environ ×1,5 de débit.
- La capture ne peut jamais dépasser la résolution de l'écran partagé : sur un écran 1080p, rien ne peut donner
  plus que du 1080p. Pour un écran 1440p ou 4K, choisis **Native**, qui prend sa vraie résolution.
- **Pendant le stream**, un changement s'applique immédiatement, sans rouvrir la fenêtre de choix d'écran
  (`videoTrack.applyConstraints()` redimensionne la capture en cours). Chaque spectateur garde sa qualité choisie,
  plafonnée à la nouvelle qualité du streamer : un spectateur en 1080p redescend en 720p si le streamer passe en
  720p, et retrouve son 1080p quand le streamer remonte.

### Qualité côté spectateur

- Le choix ne concerne que **sa** connexion : le streamer ajuste l'encodage pour ce spectateur seulement
  (`sender.setParameters`), sans coupure. Les autres spectateurs ne sont pas touchés.
- On ne dépasse jamais la qualité du streamer : demander 1080p sur un stream en 720p donne du 720p.
- La résolution ne change **jamais** toute seule. Si la connexion sature, ce sont les fps ou la netteté qui baissent :
  les **stats** (en haut à droite de la vidéo, aussi en plein écran) permettent de le voir.
- Le choix de qualité et l'affichage des stats sont retenus par le navigateur.

| Choix | Résolution | Débit max |
|---|---|---|
| Max | Celle du streamer | Celui du streamer |
| 1080p | 1920×1080 | 8 Mb/s (plafonné au débit du streamer) |
| 720p | 1280×720 | 4 Mb/s |
| 480p | 853×480 | 1,5 Mb/s |
| 360p | 640×360 | 0,8 Mb/s |

### Changer d'écran et pause

- **Changer d'écran** : on remplace la piste envoyée à chaque spectateur avec `sender.replaceTrack()`, sans
  renégocier. La qualité de chaque spectateur est réappliquée, car le nouvel écran peut avoir une autre résolution.
  Annuler la fenêtre de choix ne change rien : l'écran actuel continue.
- Un emplacement audio est toujours réservé dans chaque connexion, même vide : on peut ainsi passer d'une fenêtre
  sans son à un onglet avec du son (et inversement).
- **Pause** : `sender.replaceTrack(null)` arrête l'envoi de l'image et du son (presque plus de bande passante),
  puis `replaceTrack(piste)` le relance. La connexion WebRTC reste ouverte et les spectateurs voient la dernière
  image figée avec un bandeau « ⏸ Stream en pause ».
- Pendant la pause, la capture continue sur ton PC (dans la version navigateur, la barre « … partage votre écran »
  de Chrome reste donc affichée) : c'est ce qui permet de reprendre sans rechoisir l'écran. Un spectateur qui arrive pendant la pause voit le
  bandeau et reçoit l'image à la reprise. « Changer d'écran » et les changements de qualité pendant la pause sont
  pris en compte à la reprise.

### Structure du code

```
shared/messages.ts   Types des messages WebSocket (partagés client/serveur)
server/server.ts     Serveur HTTP (fichiers du site) + signalisation WebSocket
server/network.ts    Adresses joignables par les autres PC : IP locale et tunnel Cloudflare
server/password.ts   Accès aux salons : hachage scrypt, limite d'essais par IP, délai après un refus
server/limits.ts     Plafonds anti-abus : connexions par IP et au total, demandes par minute
shared/app-bridge.ts Ce que l'application ajoute à la page (window.umastreamApp)
client/main.ts       Code de la page : mode streamer et mode spectateur
client/app-audio.ts  Application : panneau « Son du stream » et mélangeur
client/app-picker.ts Application : fenêtre de choix d'écran (miniatures)
electron/main.ts     Application : processus principal (fenêtre, serveur intégré, choix d'écran, captures audio)
electron/preload.ts  Application : le pont entre la page et Electron
native/audio-helper/ umastream-audio.exe (Rust) : applis audio, capture du son d'une appli, fenêtres réduites
public/              main-page.html (servie sur "/"), style.css, logo.png, pcm-worklet.js, app.js (généré)
assets/umastream.ico Icône de l'application et des raccourcis, générée à partir de public/logo.png
scripts/             build-app.mjs (compile l'appli), fetch-cloudflared.ps1, make-icon.ps1, create-shortcut.ps1
UMAstream.cmd        Lanceur de la version navigateur : dépendances + serveur + tunnel + navigateur
```

Dossiers générés (ignorés par git) : `dist/` (appli compilée), `release/` (installateur),
`native/audio-helper/target/` (programme Rust compilé), `vendor/` (cloudflared.exe téléchargé).

### Limites actuelles

- **Ton adresse IP publique est visible par les spectateurs acceptés.** En pair à pair, la vidéo va directement
  de ton PC au leur : leur navigateur doit donc connaître ton adresse (elle passe dans les « candidats ICE »).
  Le tunnel Cloudflare ne change rien à ça, il ne transporte que la page. Pour masquer l'IP, il faudrait faire
  passer la vidéo par un relais (TURN ou SFU), voir l'issue dédiée.
- Chaque spectateur reçoit son propre flux : ta connexion montante limite le nombre de spectateurs (environ 2 à 4
  en 1080p).
- Pas de serveur TURN : sur certains réseaux très fermés (4G, réseau d'école…), la connexion directe peut échouer.
- Ton PC doit rester allumé avec l'appli lancée pendant le stream, et l'adresse du tunnel change à chaque lancement.
- L'application, l'icône du bureau et le lanceur ne fonctionnent que sous Windows (ailleurs : `npm install` puis
  `npm run share`, version navigateur).
- Le son par application demande Windows 11 (ou Windows 10 build 20348+).
- L'installateur n'est pas signé (une signature coûte plusieurs centaines d'euros par an) : Windows affiche un
  avertissement à l'installation.

## 4. Licence

UMAstream est sous licence [PolyForm Noncommercial 1.0.0](LICENSE.md) : tu peux l'utiliser, le modifier et le
partager librement **pour tout usage non commercial** (usage perso, école, association, recherche…), à condition de
garder la licence et la mention `Copyright (c) 2026 L. Biard`. **Tout usage commercial est interdit** sans l'accord
de l'auteur. Seul le texte anglais de [LICENSE.md](LICENSE.md) fait foi.

Les programmes inclus dans UMAstream gardent leur propre licence : voir [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

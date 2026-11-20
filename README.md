# UMAstream

Partage ton écran en haute qualité (jusqu'à la résolution native de l'écran, 60 fps) directement dans le
navigateur, via WebRTC. Pas de compte : tu lances l'appli sur ton PC, tu envoies le lien et le mot de passe,
tes potes regardent.

1. [Installation](#1-installation) : à faire une seule fois par PC
2. [Utilisation](#2-utilisation) : streamer, regarder, arrêter
3. [Comment ça marche](#3-comment-ça-marche) : les détails techniques

---

## 1. Installation

À faire **une seule fois** sur chaque PC qui veut streamer (Windows).
Pour **regarder** un stream, il n'y a rien à installer : un navigateur suffit.

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

C'est tout. Au premier lancement, l'icône installe d'elle-même ce qui manque (environ une minute).

> **Pièges possibles**
> - Projet téléchargé en ZIP : au premier double-clic, Windows peut afficher « Windows a protégé votre
>   ordinateur ». Clique sur **Informations complémentaires → Exécuter quand même**.
> - cloudflared installé alors qu'un terminal était ouvert : ferme et rouvre le terminal.
> - Dossier du projet déplacé : relance `npm run shortcut`.

---

## 2. Utilisation

### Lancer l'appli

**Double-clic sur l'icône UMAstream** du bureau. Le navigateur s'ouvre sur `http://localhost:3000` une fois le
lien internet prêt. Une fenêtre de terminal s'ouvre aussi, réduite dans la barre des tâches.

> Tu peux aussi double-cliquer sur `UMAstream.cmd`, à la racine du projet : c'est la même chose.

### Streamer ton écran

1. Choisis la **résolution** et les **fps** (1080p / 60 par défaut).
2. Choisis un **mot de passe** (obligatoire).
3. Clique sur **Partager mon écran** et choisis ce que tu partages (écran entier, fenêtre ou onglet).
   Pour partager le son, coche « Partager l'audio » dans la fenêtre de Chrome (écran entier ou onglet seulement).
4. Clique sur **Copier le lien** et envoie-le à tes potes. Vérifie que la note sous le lien est verte
   (« 🌍 Lien accessible depuis n'importe où »).
5. Envoie le **mot de passe à part** (en vocal, en message privé), jamais avec le lien.
6. Quand quelqu'un demande à entrer, il apparaît à droite dans **⏳ En attente** : clique sur ✅ pour l'accepter.

### Pendant le stream

| Bouton | Effet |
|---|---|
| Menus **Résolution / Fps** | Changent la qualité en direct, sans couper |
| **⏸ Pause** / **▶ Reprendre** | Fige l'image chez les spectateurs, sans les déconnecter |
| **🔄 Changer d'écran** | Passe à un autre écran, une autre fenêtre ou un autre onglet, sans couper |
| **🔧 Diagnostic** | Affiche ce que l'encodeur envoie vraiment (utile si ça saccade) |
| **Arrêter le partage** | Termine le stream |

Dans le panneau de droite (sous le reste sur petit écran) :

| Liste | Bouton | Effet |
|---|---|---|
| ⏳ En attente | ✅ / ❌ | Accepter / refuser la personne (refusée = 5 minutes avant de pouvoir redemander) |
| 👥 Spectateurs | 👁️ / 🙈 | Il voit / il est aveugle (plus ni image ni son pour lui seul). Un clic inverse |
| 👥 Spectateurs | 👢 | L'expulser (il peut refaire une demande) |
| | ☐ Accepter automatiquement | Toute personne qui a le bon mot de passe entre directement |

### Regarder un stream

1. Ouvre le lien reçu (ordinateur ou téléphone).
2. Tape ton **pseudo** et le **mot de passe**, puis attends que le streamer t'accepte.
3. Clique sur **🔊 Activer le son** (les navigateurs démarrent les vidéos en muet).
4. **⚙️ Options**, en haut à droite : choisis ta **qualité** (baisse-la si ta connexion rame) et affiche les
   **stats** si tu veux voir la résolution, les fps et le débit reçus.

### Arrêter l'appli

**Ferme la fenêtre du terminal** (ou `Ctrl + C` dedans). Le serveur et le tunnel s'arrêtent ensemble.
Pense à le faire quand tu ne streames pas.

### Bon à savoir

- **Tes spectateurs acceptés peuvent voir ton adresse IP** (la vidéo passe en direct entre vos PC) :
  ne partage le lien qu'avec des personnes de confiance.
- **Le lien change à chaque lancement** de l'appli : renvoie-le à chaque fois.
- **Environ 2 à 4 spectateurs en 1080p**, selon ta connexion montante.
- **Attention à ce que tu montres** : notifications, mots de passe, e-mails… Partage une fenêtre plutôt que
  l'écran entier, active « Ne pas déranger » dans Windows, et utilise ⏸ Pause avant d'ouvrir quelque chose de privé.
- Sur certains réseaux très fermés (école, entreprise, certaines 4G), la vidéo peut ne pas passer.

---

## 3. Comment ça marche

### Le principe

1. Le streamer capture son écran (`getDisplayMedia`) et demande un salon au serveur, avec un mot de passe.
2. Un spectateur ouvre le lien `?room=…`, tape son pseudo et le mot de passe ; s'il est bon, le streamer
   reçoit sa demande et l'accepte (ou la refuse).
3. Les deux navigateurs s'échangent offre, réponse et candidats ICE **via le serveur**.
4. Ensuite la vidéo passe **en direct** entre les navigateurs (pair à pair). Le serveur ne voit jamais la vidéo.

### Commandes

| Commande | Rôle |
|---|---|
| `npm run share` | Compile le client puis lance le serveur sur le port 3000, avec un tunnel Cloudflare (lien valable partout). C'est ce que lance l'icône |
| `npm run dev` | Pareil sans tunnel (lien valable sur ton réseau local) |
| `npm run build:client` | Compile `client/main.ts` en `public/app.js` (esbuild) |
| `npm run typecheck` | Vérifie les types de tout le projet (TypeScript) |
| `npm run shortcut` | Crée l'icône UMAstream sur le bureau (Windows) |
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

- L'adresse publique s'affiche dans le terminal (`Internet : https://…`). Le tunnel est gratuit et sans compte,
  mais **son adresse change à chaque lancement**.
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
- Pendant la pause, la capture continue sur ton PC (la barre « … partage votre écran » de Chrome reste affichée) :
  c'est ce qui permet de reprendre sans rechoisir l'écran. Un spectateur qui arrive pendant la pause voit le
  bandeau et reçoit l'image à la reprise. « Changer d'écran » et les changements de qualité pendant la pause sont
  pris en compte à la reprise.

### Structure du code

```
shared/messages.ts   Types des messages WebSocket (partagés client/serveur)
server/server.ts     Serveur HTTP (fichiers du site) + signalisation WebSocket
server/network.ts    Adresses joignables par les autres PC : IP locale et tunnel Cloudflare
server/password.ts   Accès aux salons : hachage scrypt, limite d'essais par IP, délai après un refus
server/limits.ts     Plafonds anti-abus : connexions par IP et au total, demandes par minute
client/main.ts       Code navigateur : mode streamer et mode spectateur
public/              main-page.html (servie sur "/"), style.css, logo.png, app.js (généré)
assets/umastream.ico Icône du raccourci, générée à partir de public/logo.png
scripts/             make-icon.ps1 (génère l'icône), create-shortcut.ps1 (crée le raccourci)
UMAstream.cmd        Lanceur : dépendances + serveur + tunnel + navigateur, en un double-clic
```

### Limites actuelles

- **Ton adresse IP publique est visible par les spectateurs acceptés.** En pair à pair, la vidéo va directement
  de ton PC au leur : leur navigateur doit donc connaître ton adresse (elle passe dans les « candidats ICE »).
  Le tunnel Cloudflare ne change rien à ça, il ne transporte que la page. Pour masquer l'IP, il faudrait faire
  passer la vidéo par un relais (TURN ou SFU), voir l'issue dédiée.
- Chaque spectateur reçoit son propre flux : ta connexion montante limite le nombre de spectateurs (environ 2 à 4
  en 1080p).
- Pas de serveur TURN : sur certains réseaux très fermés (4G, réseau d'école…), la connexion directe peut échouer.
- Ton PC doit rester allumé avec l'appli lancée pendant le stream, et l'adresse du tunnel change à chaque lancement.
- L'icône du bureau et le lanceur ne fonctionnent que sous Windows (ailleurs : `npm install` puis `npm run share`).

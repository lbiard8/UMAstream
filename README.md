# UMAstream

Partage d'écran en haute qualité (jusqu'à la résolution native de l'écran, 60 fps) directement dans le navigateur, via WebRTC.
Pas de compte, pas d'installation : tu partages, tu envoies le lien, tes potes regardent.

## Lancer le projet

```bash
npm install
npm run dev
```

Puis ouvre http://localhost:3000, clique sur **Partager mon écran** et ouvre le lien obtenu dans un autre onglet.

| Commande | Rôle |
|---|---|
| `npm run dev` | Compile le client puis lance le serveur sur le port 3000 (lien valable sur ton réseau local) |
| `npm run share` | Pareil, avec en plus un tunnel Cloudflare : le lien marche depuis n'importe où |
| `npm run build:client` | Compile `client/main.ts` en `public/app.js` (esbuild) |
| `npm run typecheck` | Vérifie les types de tout le projet (TypeScript) |

## Streamer à distance

`localhost` ne désigne que ton propre PC : un lien `http://localhost:3000/…` ne marche pas chez un ami.
Le serveur choisit donc lui-même la meilleure adresse pour le lien généré :

| Lancement | Lien généré | Qui peut l'ouvrir |
|---|---|---|
| `npm run share` (cloudflared installé) | `https://xxxx.trycloudflare.com/?room=…` | 🌍 N'importe qui |
| `npm run dev` | `http://<ton IP locale>:3000/?room=…` | 🏠 Les PC sur le même réseau (box, Wi-Fi) |
| Pas de réseau | `http://localhost:3000/?room=…` | 💻 Ce PC seulement |

### Installer cloudflared (une seule fois)

```powershell
winget install --id Cloudflare.cloudflared
```

Ferme puis rouvre ton terminal, puis lance `npm run share`. L'adresse publique s'affiche dans le terminal
(`Internet : https://…`). Le tunnel est gratuit et sans compte, mais **son adresse change à chaque lancement**.

> Le tunnel ne transporte que la page et la signalisation : la vidéo continue de passer en direct entre les PC.

> Sur certains réseaux (Wi-Fi d'université, réseau d'entreprise), les PC ne peuvent pas se joindre entre eux :
> le lien « réseau local » ne marchera pas, utilise `npm run share`.

## Mot de passe

Le streamer choisit un **mot de passe obligatoire** avant de partager. Les spectateurs doivent le taper pour regarder.

- **Il ne fait jamais partie du lien** : envoie-le à part (en vocal, en message privé). Si le lien fuit, le mot de
  passe ne fuit pas avec.
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

## Gérer les spectateurs

Le spectateur tape un **pseudo** et le mot de passe. S'il est bon, il arrive en **salle d'attente** : le streamer
voit sa demande dans le panneau de droite (sous le reste sur petit écran) et décide.

| Liste | Bouton | Effet |
|---|---|---|
| ⏳ En attente | ✅ | Accepter : la connexion WebRTC démarre, il reçoit le stream |
| ⏳ En attente | ❌ | Refuser : son IP ne peut plus redemander pendant 5 minutes |
| 👥 Spectateurs | 👁️ / 🙈 | L'émoji montre son état (il voit / il est aveugle). Un clic inverse : aveugle = plus ni image ni son pour lui seul, avec un bandeau « 🙈 Le streamer a masqué l'image pour toi » |
| 👥 Spectateurs | 👢 | Expulser : il est déconnecté. Il peut refaire une demande tout de suite |

- **Accepter automatiquement** (décochée par défaut) : toute personne qui a le bon mot de passe entre directement.
  La cocher accepte aussi ceux qui attendent déjà.
- Tant qu'un spectateur n'est pas accepté, **aucune connexion WebRTC n'existe** : ni son IP ni la tienne ne sont échangées.
- Une demande sans réponse attend indéfiniment, et disparaît si le spectateur ferme la page.
- **Le pseudo n'est pas vérifié** : n'importe qui peut taper celui d'un pote. En cas de doute, demande-lui en vocal.
- Les pseudos sont affichés avec `textContent`, jamais `innerHTML` : un pseudo comme `<b>gras</b>` s'affiche tel
  quel, sans pouvoir injecter de code chez le streamer.
- Seul le streamer du salon peut accepter, refuser ou expulser : le serveur le vérifie à chaque demande.

## Sécurité

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
- Le plus grand risque reste **ce que tu montres à l'écran** (notifications, mots de passe, e-mails) : partage une
  fenêtre plutôt que l'écran entier, active « Ne pas déranger », et utilise ⏸ Pause.
- Coupe le serveur (`Ctrl + C`) quand tu ne streames pas : le tunnel disparaît avec lui.

## Qualité côté streamer

Avant de partager, le streamer choisit une **résolution** (Native, 1080p, 720p, 480p, 360p) et un nombre
d'**images par seconde** (60 ou 30). Le choix est retenu par le navigateur (par défaut : 1080p, 60 fps).
Le débit max envoyé à chaque spectateur en découle :

| Résolution | 30 fps | 60 fps |
|---|---|---|
| Native (ex. 4K) | 14 Mb/s | 20 Mb/s |
| 1080p | 6 Mb/s | 9 Mb/s |
| 720p | 3 Mb/s | 4,5 Mb/s |
| 480p | 1,5 Mb/s | 2,2 Mb/s |
| 360p | 0,8 Mb/s | 1,2 Mb/s |

> La capture ne peut jamais dépasser la résolution de l'écran partagé : sur un écran 1080p, rien ne peut donner
> plus que du 1080p. Pour un écran 1440p ou 4K, choisis **Native**, qui prend sa vraie résolution.

60 fps = 2× plus d'images, mais elles se ressemblent et se compressent mieux : environ ×1,5 de débit.

**Pendant le stream**, les deux menus restent actifs : un changement s'applique immédiatement, sans rouvrir la
fenêtre de choix d'écran (`videoTrack.applyConstraints()` redimensionne la capture en cours). Chaque spectateur
garde sa qualité choisie, plafonnée à la nouvelle qualité du streamer : un spectateur en 1080p redescend en 720p
si le streamer passe en 720p, et retrouve son 1080p quand le streamer remonte.

## Changer d'écran pendant le stream

Le bouton **🔄 Changer d'écran** rouvre la fenêtre de choix du navigateur, avec la même résolution et les mêmes fps.
Le stream continue : même salon, même lien, les spectateurs restent connectés et voient simplement l'image changer.

- Côté code, on remplace la piste envoyée à chaque spectateur avec `sender.replaceTrack()`, sans renégocier.
- La qualité choisie par chaque spectateur est réappliquée, car le nouvel écran peut avoir une autre résolution.
- Un emplacement audio est toujours réservé dans chaque connexion, même vide : on peut ainsi passer d'une fenêtre
  sans son à un onglet avec du son (et inversement).
- Annuler la fenêtre de choix ne change rien : l'écran actuel continue.

## Mettre en pause

Le bouton **⏸ Pause** arrête l'envoi sans couper le stream : même salon, même lien, et les spectateurs restent
connectés, sans avoir à retaper le mot de passe. **▶ Reprendre** relance l'image instantanément.

- Côté code : `sender.replaceTrack(null)` arrête l'envoi de l'image et du son (presque plus de bande passante),
  puis `replaceTrack(piste)` le relance. La connexion WebRTC, elle, reste ouverte.
- Les spectateurs voient la **dernière image figée** avec un bandeau « ⏸ Stream en pause ».
- La capture continue sur ton PC (la barre « … partage votre écran » de Chrome reste affichée) : c'est ce qui
  permet de reprendre sans rechoisir l'écran.
- Un spectateur qui arrive pendant la pause voit directement le bandeau, et reçoit l'image à la reprise.
- « Changer d'écran » et les changements de qualité pendant la pause sont pris en compte à la reprise.

## Qualité côté spectateur

Chaque spectateur choisit sa qualité dans **⚙️ Options** : **Max** (celle du streamer), 1080p, 720p, 480p ou 360p.

- Le choix ne concerne que **sa** connexion : le streamer ajuste l'encodage pour ce spectateur seulement
  (`sender.setParameters`), sans coupure. Les autres spectateurs ne sont pas touchés.
- On ne dépasse jamais la qualité du streamer : demander 1080p sur un stream en 720p donne du 720p.
- La résolution ne change **jamais** toute seule. Si la connexion sature, ce sont les fps ou la netteté qui baissent :
  coche **Afficher les stats** (en haut à droite de la vidéo, aussi en plein écran) pour le voir, et baisse la qualité.
- Le choix de qualité et l'affichage des stats sont retenus par le navigateur.

| Choix | Résolution | Débit max |
|---|---|---|
| Max | Celle du streamer | Celui du streamer |
| 1080p | 1920×1080 | 8 Mb/s (plafonné au débit du streamer) |
| 720p | 1280×720 | 4 Mb/s |
| 480p | 853×480 | 1,5 Mb/s |
| 360p | 640×360 | 0,8 Mb/s |

## Structure

```
shared/messages.ts   Types des messages WebSocket (partagés client/serveur)
server/server.ts     Serveur HTTP (fichiers du site) + signalisation WebSocket
server/network.ts    Adresses joignables par les autres PC : IP locale et tunnel Cloudflare
server/password.ts   Accès aux salons : hachage scrypt, limite d'essais par IP, délai après un refus
server/limits.ts     Plafonds anti-abus : connexions par IP et au total, demandes par minute
client/main.ts       Code navigateur : mode streamer et mode spectateur
public/              main-page.html (servie sur "/"), style.css, app.js (généré)
```

## Comment ça marche

1. Le streamer capture son écran (`getDisplayMedia`) et demande un salon au serveur, avec un mot de passe.
2. Un spectateur ouvre le lien `?room=…`, tape son pseudo et le mot de passe ; s'il est bon, le streamer
   reçoit sa demande et l'accepte (ou la refuse).
3. Les deux navigateurs s'échangent offre, réponse et candidats ICE **via le serveur**.
4. Ensuite la vidéo passe **en direct** entre les navigateurs (pair à pair). Le serveur ne voit jamais la vidéo.

## Limites actuelles (V1)

- **Ton adresse IP publique est visible par les spectateurs.** En pair à pair, la vidéo va directement de ton PC
  au leur : leur navigateur doit donc connaître ton adresse (elle passe dans les « candidats ICE »). Le tunnel
  Cloudflare ne change rien à ça, il ne transporte que la page. **Ne partage le lien qu'avec des personnes de
  confiance.** Pour masquer l'IP, il faudrait faire passer la vidéo par un relais (TURN ou SFU), voir l'issue dédiée.

- Chaque spectateur reçoit son propre flux : ta connexion montante limite le nombre de spectateurs (environ 2 à 4 en 1080p).
- Pas de serveur TURN : sur certains réseaux très fermés (4G, réseau d'école…), la connexion directe peut échouer.
- Avec `npm run share`, ton PC doit rester allumé avec le serveur lancé, et l'adresse change à chaque lancement.

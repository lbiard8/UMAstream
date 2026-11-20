# UMAstream

Partage d'écran en haute qualité (1080p / 1440p, jusqu'à 60 fps) directement dans le navigateur, via WebRTC.
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

## Qualité côté streamer

Avant de partager, le streamer choisit une **résolution** (Native, 1440p, 1080p, 720p, 480p, 360p) et un nombre
d'**images par seconde** (60 ou 30). Le choix est retenu par le navigateur (par défaut : 1080p, 60 fps).
Le débit max envoyé à chaque spectateur en découle :

| Résolution | 30 fps | 60 fps |
|---|---|---|
| Native (ex. 4K) | 14 Mb/s | 20 Mb/s |
| 1440p | 9 Mb/s | 14 Mb/s |
| 1080p | 6 Mb/s | 9 Mb/s |
| 720p | 3 Mb/s | 4,5 Mb/s |
| 480p | 1,5 Mb/s | 2,2 Mb/s |
| 360p | 0,8 Mb/s | 1,2 Mb/s |

60 fps = 2× plus d'images, mais elles se ressemblent et se compressent mieux : environ ×1,5 de débit.

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
client/main.ts       Code navigateur : mode streamer et mode spectateur
public/              main-page.html (servie sur "/"), style.css, app.js (généré)
```

## Comment ça marche

1. Le streamer capture son écran (`getDisplayMedia`) et demande un salon au serveur.
2. Un spectateur ouvre le lien `?room=…` ; le serveur prévient le streamer.
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

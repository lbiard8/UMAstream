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

## Structure

```
shared/messages.ts   Types des messages WebSocket (partagés client/serveur)
server/server.ts     Serveur HTTP (fichiers du site) + signalisation WebSocket
server/network.ts    Adresses joignables par les autres PC : IP locale et tunnel Cloudflare
client/main.ts       Code navigateur : mode streamer et mode spectateur
public/              index.html, style.css, app.js (généré)
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

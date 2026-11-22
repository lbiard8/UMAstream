# Licences des programmes inclus

UMAstream est sous licence [PolyForm Noncommercial 1.0.0](LICENSE.md). Les programmes et bibliothèques
ci-dessous, inclus dans l'application ou utilisés pour la construire, ne sont **pas** concernés par cette licence :
chacun garde la sienne, rappelée ici. Toutes autorisent leur redistribution, à condition de garder leurs mentions.

## Application de bureau et serveur

| Composant | Version | Licence | Rôle |
|---|---|---|---|
| [Electron](https://github.com/electron/electron) | 45.4.1 | MIT | Fenêtre de l'application (inclut Chromium, voir ci-dessous) |
| [ws](https://github.com/websockets/ws) | 8.23.0 | MIT | Connexions WebSocket du serveur |
| [cloudflared](https://github.com/cloudflare/cloudflared) | (téléchargé par `scripts/fetch-cloudflared.ps1`) | Apache-2.0 | Tunnel qui crée le lien internet |

Electron embarque Chromium et d'autres projets libres. Leurs licences complètes sont fournies avec l'application
installée, dans les fichiers `LICENSE.electron.txt` et `LICENSES.chromium.html` (dossier d'installation).

## Programme natif `umastream-audio.exe` (Rust)

Bibliothèques compilées dans le programme, ou utilisées pendant sa compilation :

| Licence | Bibliothèques |
|---|---|
| MIT | [wasapi](https://github.com/HEnquist/wasapi-rs) 0.27.0, [sysinfo](https://github.com/GuillaumeGomez/sysinfo) 0.38.4, zmij 1.0.23 |
| MIT ou Apache-2.0 | [windows](https://github.com/microsoft/windows-rs) 0.62.2 (et windows-collections, windows-core, windows-future, windows-implement, windows-interface, windows-link, windows-numerics, windows-result, windows-strings, windows-threading), [serde_json](https://github.com/serde-rs/json) 1.0.154, serde_core 1.0.229, itoa 1.0.19, libc 0.2.191, log 0.4.35, num-integer 0.1.47, num-traits 0.2.19, ntapi 0.4.3, winapi 0.3.9, thiserror 2.0.21, thiserror-impl 2.0.21, proc-macro2 1.0.107, quote 1.0.47, syn 2.0.119, syn 3.0.10 |
| (MIT ou Apache-2.0) et Unicode-3.0 | unicode-ident 1.0.27 |
| Unlicense ou MIT | memchr 2.8.3 |

Le texte de chaque licence se trouve dans le dépôt de la bibliothèque (lien ci-dessus, ou sur
[crates.io](https://crates.io)). Textes de référence : [MIT](https://opensource.org/license/mit),
[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0), [Unicode-3.0](https://www.unicode.org/license.txt),
[Unlicense](https://unlicense.org).

## Outils de construction (non inclus dans l'application)

TypeScript (Apache-2.0), esbuild (MIT), electron-builder (MIT), tsx (MIT) : servent seulement à compiler et
à fabriquer l'installateur.

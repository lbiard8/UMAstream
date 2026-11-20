// Trouver les adresses par lesquelles les AUTRES PC peuvent joindre ce serveur.
// "localhost" ne marche que sur ce PC : on cherche donc
//  - l'IP locale (pour un PC sur le même réseau / la même box)
//  - une adresse publique via un tunnel Cloudflare (pour un PC n'importe où)

import { createSocket } from "node:dgram";
import { spawn, type ChildProcess } from "node:child_process";

/**
 * IP du PC sur son réseau (ex : 192.168.1.24), ou null si pas de réseau.
 *
 * Un PC a souvent plusieurs cartes réseau (Wi-Fi, Ethernet, VirtualBox, VPN…) et leurs
 * noms ne veulent rien dire ("Ethernet 3"). On demande donc au système : "par quelle
 * carte sortirais-tu pour aller sur internet ?". Une socket UDP "connectée" vers 8.8.8.8
 * donne la réponse SANS envoyer le moindre paquet (UDP n'a pas de poignée de main).
 */
export function getLanIp(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    socket.on("error", () => {
      socket.close();
      resolve(null);
    });
    socket.connect(53, "8.8.8.8", () => {
      const ip = socket.address().address;
      socket.close();
      resolve(ip);
    });
  });
}

/**
 * Lance un "quick tunnel" Cloudflare vers localhost:port et renvoie son URL publique
 * (https://xxxx.trycloudflare.com). Gratuit, sans compte, HTTPS automatique.
 * Renvoie null si cloudflared n'est pas installé ou ne répond pas.
 */
export function startTunnel(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      return resolve(null);
    }

    const timeout = setTimeout(() => {
      console.warn("⚠️  Le tunnel Cloudflare ne répond pas (30 s). Lien internet indisponible.");
      resolve(null);
    }, 30_000);

    // cloudflared écrit l'URL du tunnel dans ses logs : on la repère avec une regex
    const onOutput = (chunk: Buffer) => {
      const match = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === "ENOENT") {
        console.warn("⚠️  cloudflared n'est pas installé : pas de lien internet. Voir le README (« Streamer à distance »).");
      } else {
        console.warn(`⚠️  Impossible de lancer cloudflared : ${err.message}`);
      }
      resolve(null);
    });

    // Quand le serveur s'arrête (Ctrl+C), on arrête aussi le tunnel
    const stop = () => child.kill();
    process.on("exit", stop);
    process.on("SIGINT", () => process.exit());
    process.on("SIGTERM", () => process.exit());
  });
}

// Fichiers statiques du site (main-page.html, app.js, style.css…).

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Gestionnaire HTTP qui sert les fichiers du dossier `publicDir`, et rien en dehors. */
export function staticFiles(publicDir: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const urlPath = new URL(req.url ?? "/", "http://localhost").pathname;
    // "/" (accueil, et tous les liens de stream "/?room=…") -> la page principale
    const relative = urlPath === "/" ? "main-page.html" : urlPath.slice(1);
    const filePath = normalize(join(publicDir, relative));

    // Empêche de sortir du dossier public avec des "../"
    if (!filePath.startsWith(publicDir.replace(/[\\/]$/, "") + sep)) {
      res.writeHead(403).end("Interdit");
      return;
    }

    try {
      const content = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(content);
    } catch {
      res.writeHead(404).end("Introuvable");
    }
  };
}

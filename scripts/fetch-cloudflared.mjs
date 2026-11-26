// Télécharge cloudflared (le tunnel Cloudflare qui crée le lien internet) dans vendor/, pour l'inclure
// dans l'application. Marche sous Windows, macOS et Linux : `npm run fetch:cloudflared`.
//
//   node scripts/fetch-cloudflared.mjs [--os windows|macos|linux] [--arch x64|arm64|universal] [--force]
//
// Par défaut : le système et le processeur de ce PC. "universal" (macOS) réunit les versions Intel et
// Apple Silicon en un seul programme (il faut être sur un Mac : outil `lipo`).
//
// Source : les publications officielles de Cloudflare sur GitHub (licence Apache 2.0). Vérifications :
//  - l'empreinte SHA-256 de chaque fichier, publiée par GitHub (fichier non abîmé ni remplacé) ;
//  - la signature de Cloudflare quand le système sait la vérifier : Windows (Authenticode) et macOS
//    (signature Apple "Developer ID"). Le binaire Linux, lui, n'est pas signé : seule l'empreinte compte.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const vendor = join(project, "vendor");

// --- Arguments ---------------------------------------------------------------------
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const os = arg("os") ?? { win32: "windows", darwin: "macos" }[process.platform] ?? "linux";
const arch = arg("arch") ?? (process.arch === "arm64" ? "arm64" : "x64");
const force = process.argv.includes("--force");

/** Les fichiers à télécharger chez Cloudflare pour ce système / ce processeur. */
function assetsFor(os, arch) {
  const goArch = (a) => (a === "arm64" ? "arm64" : "amd64");
  if (os === "windows") return [`cloudflared-windows-${goArch(arch)}.exe`];
  if (os === "linux") return [`cloudflared-linux-${goArch(arch)}`];
  if (os === "macos") {
    return arch === "universal"
      ? ["cloudflared-darwin-amd64.tgz", "cloudflared-darwin-arm64.tgz"]
      : [`cloudflared-darwin-${goArch(arch)}.tgz`];
  }
  throw new Error(`Système inconnu : ${os}`);
}

const target = join(vendor, os === "windows" ? "cloudflared.exe" : "cloudflared");
// PIÈGE : les versions macOS et Linux portent le même nom ("cloudflared"). On note donc à côté
// pour quel système il a été téléchargé, et on ne le réutilise que si c'est le même.
const marker = join(vendor, "cloudflared.json");
const wanted = `${os}-${arch}`;
const present = existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")).target : null;
if (existsSync(target) && present === wanted && !force) {
  console.log(`cloudflared déjà présent : ${target} (${wanted} ; --force pour le retélécharger)`);
  process.exit(0);
}

// --- Téléchargement ----------------------------------------------------------------
// Sur GitHub Actions, le jeton fourni évite la limite de requêtes de l'API GitHub
const headers = { "User-Agent": "umastream-build", Accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const releaseResponse = await fetch("https://api.github.com/repos/cloudflare/cloudflared/releases/latest", { headers });
if (!releaseResponse.ok) throw new Error(`Liste des versions de cloudflared inaccessible (${releaseResponse.status})`);
const release = await releaseResponse.json();
console.log(`cloudflared ${release.tag_name} pour ${os} (${arch})`);

const work = mkdtempSync(join(tmpdir(), "cloudflared-"));
const downloaded = [];
try {
  for (const name of assetsFor(os, arch)) {
    const asset = release.assets.find((a) => a.name === name);
    if (!asset) throw new Error(`Fichier ${name} absent de la version ${release.tag_name}`);
    console.log(`Téléchargement de ${name}…`);
    const response = await fetch(asset.browser_download_url, { headers: { "User-Agent": headers["User-Agent"] } });
    if (!response.ok) throw new Error(`Téléchargement de ${name} impossible (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());

    // Empreinte : doit être EXACTEMENT celle publiée par GitHub pour ce fichier
    const expected = asset.digest?.replace(/^sha256:/, "");
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (!expected) throw new Error(`Pas d'empreinte publiée pour ${name} : vérification impossible`);
    if (actual !== expected) throw new Error(`Empreinte de ${name} différente de celle publiée : fichier refusé`);
    const file = join(work, name);
    writeFileSync(file, bytes);
    downloaded.push(file);
  }

  // --- Mise en place -----------------------------------------------------------------
  mkdirSync(vendor, { recursive: true });
  if (os === "macos") {
    // Chaque .tgz contient un programme "cloudflared" : on les extrait, puis on les réunit si besoin
    const binaries = downloaded.map((tgz, i) => {
      const dir = join(work, `bin${i}`);
      mkdirSync(dir);
      execFileSync("tar", ["-xzf", tgz, "-C", dir]);
      return join(dir, "cloudflared");
    });
    if (binaries.length > 1) execFileSync("lipo", ["-create", ...binaries, "-output", target]);
    else copyFileSync(binaries[0], target);
  } else {
    copyFileSync(downloaded[0], target);
  }
  if (os !== "windows") chmodSync(target, 0o755);

  verifySignature(target);
  writeFileSync(marker, `${JSON.stringify({ target: wanted, version: release.tag_name })}\n`);
  console.log(`cloudflared prêt : ${target}`);
} catch (err) {
  rmSync(target, { force: true });
  rmSync(marker, { force: true });
  throw err;
} finally {
  rmSync(work, { recursive: true, force: true });
}

/** Vérifie que le programme est signé par Cloudflare, quand ce PC sait le vérifier. */
function verifySignature(file) {
  if (os === "windows" && process.platform === "win32") {
    const script =
      `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; ` +
      `if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Cloudflare') { exit 1 }`;
    try {
      execFileSync("powershell", ["-NoProfile", "-Command", script], { stdio: "ignore" });
    } catch {
      throw new Error("Signature Windows de cloudflared invalide ou inattendue : fichier refusé");
    }
    console.log("Signature vérifiée : signé par Cloudflare (Authenticode)");
  } else if (os === "macos" && process.platform === "darwin") {
    execFileSync("codesign", ["--verify", "--strict", file]); // erreur si la signature est cassée
    // codesign écrit ses détails (dont le signataire) sur la sortie d'erreur, d'où le 2>&1
    const details = execFileSync("sh", ["-c", 'codesign -dv --verbose=2 "$1" 2>&1', "sh", file], { encoding: "utf8" });
    if (!/Authority=Developer ID Application: Cloudflare/.test(details)) {
      throw new Error("Signature Apple de cloudflared inattendue (pas Cloudflare) : fichier refusé");
    }
    console.log("Signature vérifiée : signé par Cloudflare (Apple Developer ID)");
  } else {
    console.log("Signature non vérifiable ici : seule l'empreinte SHA-256 a été vérifiée");
  }
}

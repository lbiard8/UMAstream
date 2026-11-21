// Compile l'application de bureau (Electron) avec esbuild : `npm run build:app`.
//
//  - dist/main.js     : processus principal d'Electron + le serveur UMAstream (server/*), en un seul fichier
//  - dist/preload.cjs : le "pont" exposé à la page (window.umastreamApp)
//
// Le serveur utilise `await` au niveau supérieur, d'où le format ESM pour main.js. Certaines
// bibliothèques (ws) utilisent encore require() : la bannière recrée require() dans un module ESM.
import { build } from "esbuild";

await build({
  entryPoints: ["electron/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron", "bufferutil", "utf-8-validate"], // fournis par Electron / optionnels pour ws
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  sourcemap: true,
});

await build({
  entryPoints: ["electron/preload.ts"],
  outfile: "dist/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs", // un preload en mode "sandbox" doit être en CommonJS
  target: "node22",
  external: ["electron"],
});

console.log("Application compilée dans dist/ (main.js, preload.cjs)");

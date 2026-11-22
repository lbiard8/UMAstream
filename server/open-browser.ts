import { spawn } from "node:child_process";

/** Ouvre une adresse dans le navigateur par défaut (Windows, macOS ou Linux). */
export function openBrowser(url: string) {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]] // le "" est le titre de fenêtre attendu par "start"
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => console.log(`Ouvre ${url} dans ton navigateur.`));
  child.unref(); // le serveur ne garde pas de lien avec le navigateur
}

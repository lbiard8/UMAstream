// Boutons « œil » à côté des mots de passe : afficher / masquer ce qu'on tape.
// Chaque bouton `.password-toggle` indique son champ avec data-for="id-du-champ" (voir main-page.html).

import { icon } from "./icons.js";

export function setupPasswordToggles() {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".password-toggle[data-for]")) {
    const input = document.getElementById(button.dataset.for!) as HTMLInputElement | null;
    if (!input) continue;
    button.addEventListener("click", () => {
      const visible = input.type === "password"; // il était masqué : on l'affiche
      input.type = visible ? "text" : "password";
      const label = visible ? "Masquer le mot de passe" : "Afficher le mot de passe";
      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute("aria-label", label);
      button.title = label;
      button.replaceChildren(icon(visible ? "eye-off" : "eye"));
      input.focus();
    });
  }
}

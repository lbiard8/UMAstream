// Petits outils pour la page.

/** Élément de la page par son id (main-page.html). */
export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Ligne d'état sous le titre (message d'information, ou d'erreur en rouge). */
export function setStatus(text: string, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

/** Texte actuellement affiché dans la ligne d'état. */
export const currentStatus = () => $("status").textContent ?? "";

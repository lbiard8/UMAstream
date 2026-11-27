// Panneau de droite du streamer : salle d'attente (✅ / ❌) et spectateurs (👁️ / 🙈, 👢).
// Il ne fait QU'AFFICHER : ce que font les boutons lui est fourni (PeopleActions).
//
// Les pseudos sont tapés par les spectateurs : on les affiche avec textContent, JAMAIS innerHTML.
// Sinon un pseudo comme "<img src=x onerror=…>" exécuterait du code chez le streamer (faille XSS).

import { $ } from "../core/dom.js";
import { icon, type IconName } from "../core/icons.js";
import type { ViewerSummary } from "./viewer-peers.js";

export interface PeopleActions {
  answer(viewerId: string, accept: boolean): void;
  toggleBlind(viewerId: string): void;
  kick(viewerId: string): void;
}

/** Petit bouton avec une icône, et un libellé lisible au survol et par les lecteurs d'écran. */
function iconButton(name: IconName, label: string, onClick: () => void) {
  const btn = document.createElement("button");
  btn.append(icon(name));
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.addEventListener("click", onClick);
  return btn;
}

/** Une ligne de liste : le pseudo, puis les boutons. */
function personRow(name: string, buttons: HTMLButtonElement[]) {
  const li = document.createElement("li");
  const nameEl = document.createElement("span");
  nameEl.className = "name";
  nameEl.textContent = name; // textContent : le pseudo est affiché comme du texte, jamais interprété
  nameEl.title = name;
  li.append(nameEl, ...buttons);
  return li;
}

export class PeoplePanel {
  constructor(private readonly actions: PeopleActions) {}

  render(pending: [id: string, name: string][], viewers: ViewerSummary[]) {
    const { answer, toggleBlind, kick } = this.actions;
    $("pending-list").replaceChildren(
      ...pending.map(([id, name]) =>
        personRow(name, [
          iconButton("check", `Accepter ${name}`, () => answer(id, true)),
          iconButton("close", `Refuser ${name}`, () => answer(id, false)),
        ]),
      ),
    );
    $("viewer-list").replaceChildren(
      ...viewers.map(({ id, name, blind }) => {
        const row = personRow(name, [
          // L'icône montre l'ÉTAT actuel : œil ouvert = il voit, œil barré = il est aveugle. Un clic inverse.
          iconButton(blind ? "eye-off" : "eye", blind ? `Rendre la vue à ${name}` : `Rendre ${name} aveugle`, () =>
            toggleBlind(id),
          ),
          iconButton("kick", `Expulser ${name}`, () => kick(id)),
        ]);
        row.classList.toggle("is-blind", blind);
        return row;
      }),
    );
    $("pending-count").textContent = String(pending.length);
    $("watching-count").textContent = String(viewers.length);
    $("viewer-count").textContent = String(viewers.length);
    // "Personne pour l'instant" sous une liste vide
    // [data-for] : seulement les textes liés à une liste (le panneau du son réutilise la classe)
    for (const empty of document.querySelectorAll<HTMLElement>(".people-empty[data-for]")) {
      empty.hidden = $(empty.dataset.for!).childElementCount > 0;
    }
  }
}

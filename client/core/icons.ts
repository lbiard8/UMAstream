// Icônes de l'interface (dessinées une seule fois dans public/icons.svg).
// Elles remplacent les émojis, dont le dessin et l'alignement changent entre Windows, macOS et Linux.

export type IconName =
  | "pause" | "play" | "stop" | "screen" | "pulse" | "sliders" | "volume" | "volume-off" | "maximize"
  | "eye" | "eye-off" | "check" | "close" | "kick" | "mic" | "alert" | "globe" | "home" | "laptop"
  | "lock" | "key" | "clock" | "users" | "chevron-down" | "chevron-right" | "refresh";

const SVG = "http://www.w3.org/2000/svg";

/** Une icône, décorative (le texte ou le libellé à côté dit ce qu'elle veut dire). */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `icons.svg#${name}`);
  svg.append(use);
  return svg;
}

/** Remplace le contenu d'un élément par une icône suivie d'un texte (textContent : jamais du HTML). */
export function setIconText(element: HTMLElement, name: IconName, text: string) {
  const label = document.createElement("span");
  label.textContent = text;
  element.replaceChildren(icon(name), label);
}

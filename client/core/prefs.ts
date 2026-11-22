// Préférences retenues par le navigateur (localStorage). Le stockage peut être bloqué
// (navigation privée, cookies refusés) : dans ce cas on ignore l'erreur et on prend la valeur par défaut.

export function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(`umastream.${key}`);
  } catch {
    return null;
  }
}

export function savePref(key: string, value: string) {
  try {
    localStorage.setItem(`umastream.${key}`, value);
  } catch {
    /* stockage indisponible : le choix ne sera juste pas retenu */
  }
}

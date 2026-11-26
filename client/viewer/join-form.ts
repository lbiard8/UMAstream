// Formulaire du spectateur pour entrer dans le salon : pseudo + mot de passe.

import { MAX_NAME_LENGTH, type BlockReason } from "../../shared/messages.js";
import { $, setStatus } from "../core/dom.js";
import { loadPref, savePref } from "../core/prefs.js";

export class JoinForm {
  private readonly form = $<HTMLFormElement>("password-form");
  private readonly passwordInput = $<HTMLInputElement>("viewer-password");
  private readonly button = $<HTMLButtonElement>("password-btn");
  private readonly error = $("password-error");
  private readonly nameInput = $<HTMLInputElement>("viewer-name");

  /** onSubmit : appelé avec un pseudo et un mot de passe non vides. */
  constructor(onSubmit: (name: string, password: string) => void) {
    // Pseudo : retenu par le navigateur (ce n'est pas une info secrète), pour ne pas le retaper à chaque stream
    this.nameInput.maxLength = MAX_NAME_LENGTH;
    this.nameInput.value = loadPref("name") ?? "";

    this.form.addEventListener("submit", (e) => {
      e.preventDefault(); // sinon le navigateur rechargerait la page en envoyant le formulaire
      const name = this.nameInput.value.trim();
      if (name.length === 0) {
        this.error.textContent = "Choisis un pseudo : c'est lui que le streamer verra.";
        this.nameInput.focus();
        return;
      }
      if (this.passwordInput.value.length === 0) return;
      savePref("name", name);
      this.button.disabled = true; // un seul essai à la fois
      this.error.textContent = "";
      setStatus("");
      onSubmit(name, this.passwordInput.value);
    });
  }

  /** Le salon existe : on demande le mot de passe (le streamer ne sait même pas qu'on est là). */
  show() {
    setStatus("");
    this.form.hidden = false;
    (this.nameInput.value ? this.passwordInput : this.nameInput).focus();
  }

  hide() {
    this.form.hidden = true;
  }

  wrongPassword(attemptsLeft: number) {
    this.error.textContent = `Mot de passe incorrect : ${attemptsLeft} essai(s) restant(s).`;
    this.passwordInput.value = "";
    this.button.disabled = false;
    this.passwordInput.focus();
  }

  /** Bloqué pour cette adresse IP (trop d'erreurs, ou refusé récemment). */
  blocked(reason: BlockReason, retryAfterSeconds: number) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    const why = reason === "refused" ? "Le streamer a refusé ta demande." : "Trop d'essais.";
    this.form.hidden = false;
    this.error.textContent = `${why} Réessaie dans ${minutes} minute(s), en rechargeant la page.`;
    this.lock();
    setStatus("");
  }

  /** Formulaire hors service (bloqué, refusé, expulsé) : on le désactive entièrement. */
  lock() {
    this.nameInput.disabled = true;
    this.passwordInput.disabled = true;
    this.button.disabled = true;
  }

  /** Erreur corrigeable (ex. "Choisis un pseudo") : on peut réessayer. */
  allowRetry() {
    this.button.disabled = false;
  }

  /**
   * La reconnexion a pris trop de temps : il faut retaper le mot de passe. Le message va dans le
   * formulaire (et pas dans la ligne d'état, que "password-required" efface juste après).
   */
  reconnectionTooLate() {
    this.error.textContent = "La reconnexion a pris trop de temps : retape le mot de passe pour revenir.";
    this.passwordInput.value = "";
    this.button.disabled = false;
  }
}

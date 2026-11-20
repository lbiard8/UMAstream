// Mot de passe des salons : hachage, vérification, et limite d'essais par adresse IP.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

// ---------------------------------------------------------------------------
// 1. Hachage
// ---------------------------------------------------------------------------
// On ne garde JAMAIS le mot de passe en clair, même en mémoire : seulement son "empreinte".
// scrypt est volontairement lent et gourmand en mémoire, ce qui rend les essais en masse coûteux.
// Le "sel" aléatoire fait que deux salons avec le même mot de passe ont des empreintes différentes.

export interface PasswordHash {
  salt: Buffer;
  hash: Buffer;
}

/** Longueur max acceptée : au-delà, ce n'est plus un mot de passe mais une tentative d'abus. */
export const MAX_PASSWORD_LENGTH = 128;

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(16);
  return { salt, hash: await scryptAsync(password, salt, 32) };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const candidate = await scryptAsync(password, stored.salt, 32);
  // timingSafeEqual compare en temps constant : le temps de réponse ne révèle pas
  // combien de caractères sont justes (une comparaison === s'arrêterait au premier écart).
  return timingSafeEqual(candidate, stored.hash);
}

// ---------------------------------------------------------------------------
// 2. Limite d'essais par adresse IP
// ---------------------------------------------------------------------------
// Bloquer seulement la CONNEXION ne suffirait pas (il suffirait de recharger la page),
// et bloquer tout le SALON permettrait à un inconnu de bloquer tes potes exprès.
// On bloque donc l'adresse IP qui se trompe, et elle seule.

const MAX_ATTEMPTS = 5;
const BLOCK_MS = 5 * 60_000; // 5 minutes de blocage après 5 erreurs
const FORGET_MS = 15 * 60_000; // les erreurs sont oubliées après 15 min sans nouvel essai
const DELAY_STEP_MS = 500; // pause croissante : 0 s, 0,5 s, 1 s, 1,5 s, 2 s

interface Attempts {
  failures: number;
  lastFailure: number;
  blockedUntil: number; // 0 = pas bloqué
}

export class AttemptLimiter {
  private byIp = new Map<string, Attempts>();

  private get(ip: string): Attempts | undefined {
    const entry = this.byIp.get(ip);
    if (!entry) return undefined;
    const now = Date.now();
    const blockOver = entry.blockedUntil !== 0 && entry.blockedUntil <= now;
    const stale = entry.blockedUntil === 0 && now - entry.lastFailure > FORGET_MS;
    if (blockOver || stale) {
      this.byIp.delete(ip);
      return undefined;
    }
    return entry;
  }

  /** Secondes de blocage restantes pour cette IP (0 = elle peut essayer). */
  blockedFor(ip: string): number {
    const entry = this.get(ip);
    if (!entry || entry.blockedUntil === 0) return 0;
    return Math.ceil((entry.blockedUntil - Date.now()) / 1000);
  }

  /** Pause à faire avant de vérifier : plus on s'est trompé, plus on attend. */
  delayMs(ip: string): number {
    return (this.get(ip)?.failures ?? 0) * DELAY_STEP_MS;
  }

  /** Enregistre une erreur. Renvoie le nombre d'essais restants (0 = IP bloquée). */
  fail(ip: string): number {
    const entry = this.get(ip) ?? { failures: 0, lastFailure: 0, blockedUntil: 0 };
    entry.failures++;
    entry.lastFailure = Date.now();
    if (entry.failures >= MAX_ATTEMPTS) entry.blockedUntil = Date.now() + BLOCK_MS;
    this.byIp.set(ip, entry);
    return Math.max(0, MAX_ATTEMPTS - entry.failures);
  }

  /** Bon mot de passe : on efface les erreurs de cette IP. */
  succeed(ip: string) {
    this.byIp.delete(ip);
  }
}

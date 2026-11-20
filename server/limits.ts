// Plafonds anti-abus : larges pour ne jamais gêner un usage normal (quelques potes),
// mais suffisants pour qu'un script ne puisse pas saturer le PC qui fait tourner UMAstream.

/** Connexions WebSocket ouvertes en même temps depuis UNE adresse IP (plusieurs potes d'une même box = OK). */
export const MAX_CONNECTIONS_PER_IP = 10;
/** Connexions ouvertes en même temps au total (en pair à pair, on sert de toute façon 2 à 4 spectateurs). */
export const MAX_CONNECTIONS_TOTAL = 100;
/** Demandes "je veux rejoindre" par IP et par minute (un humain en fait 1 ou 2). */
export const MAX_JOIN_REQUESTS_PER_MINUTE = 20;
/** Demandes en salle d'attente par salon (le panneau du streamer ne peut pas être inondé). */
export const MAX_PENDING_PER_ROOM = 20;

/** Compte les connexions ouvertes par adresse IP. */
export class ConnectionCounter {
  private byIp = new Map<string, number>();

  count(ip: string): number {
    return this.byIp.get(ip) ?? 0;
  }

  add(ip: string) {
    this.byIp.set(ip, this.count(ip) + 1);
  }

  remove(ip: string) {
    const left = this.count(ip) - 1;
    if (left > 0) this.byIp.set(ip, left);
    else this.byIp.delete(ip); // on ne garde pas de trace des IP parties
  }
}

/**
 * Limite le nombre d'actions par IP sur une fenêtre de temps ("20 par minute").
 * Fenêtre fixe : le compteur repart de zéro une minute après la première action.
 */
export class RateLimiter {
  private byIp = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Enregistre une action. Renvoie false si cette IP a dépassé la limite. */
  tryConsume(ip: string): boolean {
    const now = Date.now();
    let entry = this.byIp.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.byIp.set(ip, entry);
    }
    entry.count++;
    return entry.count <= this.limit;
  }
}

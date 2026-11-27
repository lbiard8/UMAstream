// D'où vient une connexion WebSocket : la page UMAstream elle-même, ou un autre site ?
//
// Pourquoi : un site quelconque ouvert dans le navigateur du streamer peut tenter de se connecter à
// ws://localhost:3000. Le serveur le prendrait pour « ce PC » (c'est bien ce PC qui se connecte)
// et l'autoriserait à créer un salon. Le navigateur, lui, dit TOUJOURS de quelle page vient une
// connexion WebSocket (en-tête « Origin ») : on n'accepte que les pages servies par UMAstream.
//
// Liste fermée (et pas « même adresse que le serveur ») : un site piégé qui ferait pointer son propre
// nom vers 127.0.0.1 (« DNS rebinding ») aurait sinon la même adresse que nous.

/** Adresses (origines) d'où la page UMAstream peut être ouverte. */
export function allowedOrigins(port: number, lanIp: string | null, tunnelUrl: string | null): string[] {
  const origins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`];
  if (lanIp) origins.push(`http://${lanIp}:${port}`);
  if (tunnelUrl) origins.push(new URL(tunnelUrl).origin);
  return origins;
}

/**
 * La connexion vient-elle d'une page UMAstream ?
 * Sans en-tête Origin, ce n'est pas un navigateur (un outil en ligne de commande, un script de test) :
 * aucun site web ne peut alors être derrière, on accepte.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (origin === undefined) return true;
  return allowed.includes(origin.toLowerCase());
}

// Aiguillage des messages WebSocket : une table « type de message -> fonction qui le traite ».
//
// Pourquoi une table plutôt qu'un gros `switch` (principe « O » de SOLID : ouvert / fermé) :
// pour gérer un nouveau message, on AJOUTE une entrée dans la table, sans toucher au code qui
// aiguille ni aux autres gestionnaires. Et TypeScript donne à chaque gestionnaire le bon type de
// message : dans `"joined": (msg) => …`, msg.resumeToken existe, sans vérification à la main.

/** Pour chaque type de message, la fonction qui le traite (facultative : un message non prévu est ignoré). */
export type MessageHandlers<M extends { type: string }, Extra extends unknown[] = []> = {
  [K in M["type"]]?: (msg: Extract<M, { type: K }>, ...extra: Extra) => unknown;
};

/** Appelle le gestionnaire du type de `msg` (s'il y en a un) et renvoie son résultat. */
export function dispatch<M extends { type: string }, Extra extends unknown[]>(
  handlers: MessageHandlers<M, Extra>,
  msg: M,
  ...extra: Extra
): unknown {
  const handler = handlers[msg.type as M["type"]] as ((msg: M, ...extra: Extra) => unknown) | undefined;
  return handler?.(msg, ...extra);
}

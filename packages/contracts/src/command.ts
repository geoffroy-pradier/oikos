import { z } from 'zod';

/** En-tête HTTP portant la clé d'idempotence d'une commande. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * Clé d'idempotence : choisie par le client, une par intention du joueur (et non par tentative réseau).
 * Rejouer une commande avec la même clé rend la réponse enregistrée, sans second effet.
 */
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

/** Erreurs du cadre de commandes, communes à toutes les commandes. */
export const FRAMEWORK_ERROR_CODES = [
  'COMMAND_NOT_FOUND',
  'IDEMPOTENCY_KEY_REQUIRED',
  /** La clé a déjà servi pour une autre commande ou une autre entrée. */
  'IDEMPOTENCY_KEY_REUSED',
  'RATE_LIMITED',
] as const;

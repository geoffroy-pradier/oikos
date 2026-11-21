import { z } from 'zod';

/**
 * Liturgies (docs/specs/06-cites-politique-communaute.md, 6.4 ; #719) : genres d'une liturgie, liste fermée que la
 * base vérifie aussi et que la configuration reprend (`liturgies.genres`). Le genre ne change que le libellé.
 */
export const LITURGY_GENRES = ['festival', 'trierarchy', 'choregia'] as const;
export type LiturgyGenre = (typeof LITURGY_GENRES)[number];

/**
 * La clôture de bascule de saison a désigné une maison : sa liturgie, sa cité, sa saison, son genre, son dû en
 * oboles et son échéance. Les événements de domaine ne sont lus que par le serveur : le dû n'en sort pas.
 */
export const liturgyAssignedSchema = z.strictObject({
  type: z.literal('LiturgyAssigned'),
  payload: z.strictObject({
    liturgyId: z.uuid(),
    houseId: z.uuid(),
    cityId: z.uuid(),
    season: z.number().int(),
    genre: z.enum(LITURGY_GENRES),
    due: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    dueDay: z.number().int().nonnegative(),
    dueAt: z.iso.datetime(),
  }),
});

const oboles = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const due = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const gain = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const godId = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);

/**
 * Commande `liturgy.perform` (6.4, #720) : la maison accomplit sa liturgie avant l'échéance. Elle paie son dû et le
 * faste qu'elle choisit, au plus la borne de la configuration, en une écriture vers le puits `sink_liturgies` ; elle
 * gagne la Timè et la Charis envers le dieu protecteur de sa cité de la configuration, d'autant plus que le faste est
 * grand. Le dû envoyé est celui que le joueur a vu (`my_liturgies`) : un autre est refusé (`PRICE_CHANGED`).
 */
export const liturgyPerformInputSchema = z.strictObject({
  liturgyId: z.uuid(),
  expectedDue: due,
  /** Oboles payées au-delà du dû ; zéro : le dû seul. */
  splendor: oboles,
});
export type LiturgyPerformInput = z.infer<typeof liturgyPerformInputSchema>;

const performed = {
  liturgyId: z.uuid(),
  cityId: z.uuid(),
  season: z.number().int(),
  genre: z.enum(LITURGY_GENRES),
  due,
  splendor: oboles,
  /** Timè gagnée, rognée aux bornes de la Timè ; zéro sans gain. */
  honorGained: gain,
  /** Charis gagnée envers `godId` ; zéro, et `godId` nul, sans dieu protecteur ou sans gain. */
  charisGained: gain,
  godId: godId.nullable(),
};
export const liturgyPerformOutputSchema = z.object(performed);
export type LiturgyPerformOutput = z.infer<typeof liturgyPerformOutputSchema>;

export const LITURGY_PERFORM_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Aucune liturgie de cet identifiant pour la maison : celle d'une autre maison est inconnue. */
  'LITURGY_NOT_FOUND',
  /** La liturgie est déjà accomplie ou prélevée d'office. */
  'LITURGY_SETTLED',
  /** L'échéance est passée : la liturgie sera, ou a été, prélevée d'office. */
  'LITURGY_OVERDUE',
  /** Le dû de la liturgie n'est pas celui que le client a envoyé : rien n'est payé. */
  'PRICE_CHANGED',
  /** Le faste dépasse la borne de la configuration en vigueur, que le message donne. */
  'SPLENDOR_OUT_OF_BOUNDS',
  'INSUFFICIENT_FUNDS',
  /** La Charis de la maison envers le dieu dépasserait le plus grand entier sûr. */
  'CHARIS_LIMIT_REACHED',
] as const;
export type LiturgyPerformErrorCode = (typeof LITURGY_PERFORM_ERROR_CODES)[number];

/** Une maison a accompli sa liturgie : ce qu'elle a payé et ce qu'elle a gagné. Lu par le seul serveur. */
export const liturgyPerformedSchema = z.strictObject({
  type: z.literal('LiturgyPerformed'),
  payload: z.strictObject({ ...performed, houseId: z.uuid() }),
});

/**
 * La clôture de l'échéance a prélevé d'office une liturgie non accomplie : son dû, ce que la trésorerie a couvert
 * (`levied`, de zéro au dû, le reste abandonné) et la Timè perdue, positive ou nulle. Lu par le seul serveur.
 */
export const liturgyLeviedSchema = z.strictObject({
  type: z.literal('LiturgyLevied'),
  payload: z.strictObject({
    liturgyId: z.uuid(),
    houseId: z.uuid(),
    cityId: z.uuid(),
    season: z.number().int(),
    due,
    levied: oboles,
    honorLost: gain,
    gameDay: z.number().int().nonnegative(),
  }),
});

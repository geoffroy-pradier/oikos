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

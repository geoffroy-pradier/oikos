import { z } from 'zod';

/**
 * Citoyenneté et élection de l'archonte (docs/specs/06-cites-politique-communaute.md, 6.2 ; #260).
 * Une maison métèque devient citoyenne d'elle-même, à la clôture (`CitizenshipGranted`).
 */
export const citizenshipGrantedSchema = z.strictObject({
  type: z.literal('CitizenshipGranted'),
  payload: z.strictObject({
    houseId: z.uuid(),
    cityId: z.uuid(),
    /** Jour de jeu dont la clôture l'a faite citoyenne. */
    gameDay: z.number().int().nonnegative(),
  }),
});

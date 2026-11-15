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

/**
 * Dépouillement d'une élection qui a un élu : la candidature maintenue qui a le plus de bulletins, la plus
 * ancienne en cas d'égalité. Une élection sans candidat ne produit pas d'événement : la charge reste vacante.
 */
export const archonElectedSchema = z.strictObject({
  type: z.literal('ArchonElected'),
  payload: z.strictObject({
    electionId: z.uuid(),
    cityId: z.uuid(),
    houseId: z.uuid(),
    /** Bulletins reçus par l'élu. */
    votes: z.number().int().nonnegative(),
    termStartsAt: z.iso.datetime(),
    termEndsAt: z.iso.datetime(),
  }),
});

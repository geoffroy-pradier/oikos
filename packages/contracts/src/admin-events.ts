import { z } from 'zod';

/**
 * Lecture `GET /api/admin/events` : calendrier des événements du monde dans Olympe (module Animation ;
 * docs/specs/15-back-office-olympe.md, 15.1 ; 7.3, 7.4 ; #267, #446). Le schéma choisit les champs rendus :
 * l'API passe sa réponse par lui, si bien qu'une colonne lue en plus (la graine d'un événement, qui ferait
 * prévoir l'avenir) ne sort jamais. Les modèles sont ceux du catalogue fermé de la phase 2 (7.4).
 */
export const worldEventModelSchema = z.enum(['drought', 'good_year', 'storm', 'caravan']);

/** Un événement du calendrier ; cités et bien par leur identifiant de la configuration. */
export const adminWorldEventSchema = z.object({
  id: z.uuid(),
  /** Identifiant court du monde. */
  world: z.string(),
  model: worldEventModelSchema,
  city: z.string(),
  /** Seconde cité d'une tempête (une route) ; nulle sinon. */
  otherCity: z.string().nullable(),
  /** Bien d'une caravane ; nul sinon. */
  goodId: z.string().nullable(),
  startsAt: z.iso.datetime(),
  /** Fin exclue. */
  endsAt: z.iso.datetime(),
  magnitudeBps: z.number().int().min(0).max(10_000),
  plannedDay: z.number().int().nonnegative(),
});
export type AdminWorldEvent = z.infer<typeof adminWorldEventSchema>;

export const adminEventsDataSchema = z.object({
  /** Heure de la base, qui fait foi pour l'état de chaque événement (à venir, en cours, passé). */
  now: z.iso.datetime(),
  /** Fenêtre du passé : les événements finis depuis plus de jours que cela ne sont pas rendus. */
  pastDays: z.number().int().positive(),
  /** Des plus tardifs aux plus anciens. */
  events: z.array(adminWorldEventSchema),
  /** La liste atteint la limite de la lecture : des événements plus anciens n'y sont pas. */
  truncated: z.boolean(),
});
export type AdminEventsData = z.infer<typeof adminEventsDataSchema>;

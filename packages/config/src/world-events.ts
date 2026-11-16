import { z } from 'zod';

/**
 * Événements du monde (docs/specs/07-dieux-faveur-evenements.md, 7.3 et 7.4 ; #267). Le catalogue est fermé :
 * le moteur ne connaît que ces modèles, et leur effet est fixé par le modèle (sécheresse : rendement des champs
 * d'une cité ; bonne année : rendement des vergers d'une cité ; tempête : durée des trajets d'une route ;
 * caravane étrangère : demande des PNJ d'une cité pour un bien). La configuration n'en règle que la
 * probabilité par jour, la durée et l'ampleur, bornées. Un modèle absent n'est jamais planifié.
 * Jamais lue par les joueurs : probabilités et bornes ne sortent pas de l'API et du moteur.
 */
export const WORLD_EVENT_MODELS = ['drought', 'good_year', 'storm', 'caravan'] as const;
export type WorldEventModel = (typeof WORLD_EVENT_MODELS)[number];

const id = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const days = z.number().int().min(1).max(30);
/** Ampleur en points de base : au plus 10 000, soit un rendement nul, doublé, ou un trajet deux fois plus long. */
const magnitudeBps = z.number().int().min(0).max(10_000);

const modelShape = {
  /** Probabilité que le modèle survienne, tirée une fois par jour de jeu planifié, en points de base. */
  probabilityBps: z.number().int().min(0).max(10_000),
  /** Durée tirée entre ces bornes, en jours de jeu pleins, comprises. */
  minDays: days,
  maxDays: days,
  /** Ampleur tirée entre ces bornes, comprises (voir `magnitudeBps`). */
  minMagnitudeBps: magnitudeBps,
  maxMagnitudeBps: magnitudeBps,
};
const modelSchema = z.strictObject(modelShape);

export const worldEventsSchema = z.strictObject({
  /**
   * Délai de planification : la clôture qui ouvre le jour J planifie les événements qui commencent au jour
   * J + ce délai. Au moins un jour : un événement est toujours connu du moteur avant de commencer.
   */
  planningLeadDays: z.number().int().min(1).max(30),
  models: z.strictObject({
    drought: modelSchema.optional(),
    good_year: modelSchema.optional(),
    storm: modelSchema.optional(),
    /** Caravane : le bien est tiré parmi `goodIds`, des biens du panier d'une classe de PNJ, sans doublon. */
    caravan: z.strictObject({ ...modelShape, goodIds: z.array(id).min(1).max(60) }).optional(),
  }),
});
export type WorldEvents = z.infer<typeof worldEventsSchema>;

/**
 * Contrôles qui demandent plusieurs champs ou le reste de la configuration : chaque minimum au plus égal à son
 * maximum, et des biens de caravane connus, chacun une fois, achetés par au moins une classe de PNJ (sinon la
 * caravane n'aurait aucun effet). Rend des chemins sous `worldEvents`.
 */
export function worldEventsIssues(
  worldEvents: WorldEvents,
  basketGoods: ReadonlySet<string>,
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  for (const model of WORLD_EVENT_MODELS) {
    const rules = worldEvents.models[model];
    if (!rules) continue;
    if (rules.minDays > rules.maxDays)
      issues.push({ path: ['models', model, 'maxDays'], message: 'below the minimum' });
    if (rules.minMagnitudeBps > rules.maxMagnitudeBps)
      issues.push({ path: ['models', model, 'maxMagnitudeBps'], message: 'below the minimum' });
  }
  worldEvents.models.caravan?.goodIds.forEach((goodId, index, all) => {
    if (!basketGoods.has(goodId) || all.indexOf(goodId) < index)
      issues.push({
        path: ['models', 'caravan', 'goodIds', index],
        message: `unknown, duplicate or unbought good "${goodId}"`,
      });
  });
  return issues;
}

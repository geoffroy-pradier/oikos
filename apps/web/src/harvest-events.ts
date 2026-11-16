import {
  cycleYield,
  WORLD_EVENT_CATALOGUE,
  yieldDeltaBps,
  yieldModelOf,
  type WorldEventKind,
} from '@oikos/sim';
import type { SiteRecipe } from './site-rules';
import type { WorldEvent } from './world-events';

/** Modèles d'événement qui touchent un rendement (sécheresse, bonne année ; 7.4). */
export const YIELD_MODELS = (Object.keys(WORLD_EVENT_CATALOGUE) as WorldEventKind[]).filter(
  (model) => WORLD_EVENT_CATALOGUE[model].siteType !== null,
);

interface Stack {
  goodId: string;
  quantity: number;
}

/** Événements de rendement d'un site (7.4) : ceux de sa cité, du modèle qui touche son type de site. */
export function yieldEventsOf(events: readonly WorldEvent[], cityId: string, siteType: string) {
  const model = yieldModelOf(siteType);
  return events.filter((event) => event.model === model && event.cityId === cityId);
}

/** Écart signé de chaque extrant à son rendement sans événement (`cycles` × extrant par cycle), s'il y en a un. */
export function yieldGaps(recipe: SiteRecipe, cycles: number, outputs: readonly Stack[]): Stack[] {
  return recipe.outputs.flatMap(({ goodId, quantity: perCycle }) => {
    const got = outputs.find((stack) => stack.goodId === goodId)?.quantity ?? 0;
    const gap = got - cycles * perCycle;
    return gap === 0 ? [] : [{ goodId, quantity: gap }];
  });
}

/**
 * Écarts qu'un modèle de rendement explique : tous du signe de son effet (sécheresse en moins, bonne année en
 * plus). Un écart d'un autre signe n'est pas de son fait (une version de configuration qui change l'extrant
 * entre l'affichage et la récolte, par exemple) : rien n'est expliqué.
 */
export function gapsExplainedBy(model: WorldEventKind, gaps: readonly Stack[]): readonly Stack[] {
  const { sign } = WORLD_EVENT_CATALOGUE[model];
  return gaps.every((gap) => Math.sign(gap.quantity) === sign) ? gaps : [];
}

/**
 * Ce que rendraient les `cycles` premiers cycles après `cycleStartedAt` sous les événements de rendement du
 * site (`yieldEventsOf`), calculé comme l'API (`cycleYield`) : chaque cycle qui se termine pendant un
 * événement produit selon le plus fort en cours. Indicatif : l'API recalcule à la récolte.
 */
export function harvestUnderEvents(
  recipe: SiteRecipe,
  cycles: number,
  cycleStartedAt: Date,
  events: readonly WorldEvent[],
) {
  const effects = events.map((event) => ({
    eventId: event.id,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    deltaBps: yieldDeltaBps(event.model, event.magnitudeBps),
  }));
  const outputs = recipe.outputs.map(({ goodId, quantity }) => ({
    goodId,
    quantity: cycleYield({
      since: cycleStartedAt,
      cycleMinutes: recipe.durationMinutes,
      cycles,
      outputPerCycle: quantity,
      effects,
    }).quantity,
  }));
  return { outputs, gaps: yieldGaps(recipe, cycles, outputs) };
}

import { WORLD_EVENT_CATALOGUE, type WorldEventKind } from './world-events';

/**
 * Effets des événements du monde (docs/specs/07-dieux-faveur-evenements.md, 7.4 ; #267) : calculs purs, en
 * entiers, qui ne dépendent que des événements en cours et de l'instant ou du jour de jeu.
 */
const BPS = 10_000;
const KINDS = Object.keys(WORLD_EVENT_CATALOGUE) as WorldEventKind[];

/** Un événement en cours sur un intervalle d'instants, le début compris, la fin exclue. */
export interface TimedEffect {
  eventId: string;
  startsAt: Date;
  endsAt: Date;
  /** Variation en points de base : négative pour une sécheresse, positive sinon. */
  deltaBps: number;
}

/** Variation de rendement d'un événement de rendement, signée selon son modèle ; nulle pour un autre modèle. */
export function yieldDeltaBps(model: WorldEventKind, magnitudeBps: number): number {
  const entry = WORLD_EVENT_CATALOGUE[model];
  return entry.siteType === null ? 0 : entry.sign * magnitudeBps;
}

/** Modèle de rendement qui touche un type de site, s'il y en a un. */
export function yieldModelOf(siteType: string): WorldEventKind | undefined {
  return KINDS.find((model) => WORLD_EVENT_CATALOGUE[model].siteType === siteType);
}

/**
 * L'événement le plus fort en cours à l'instant donné (plus grande variation en valeur absolue ; à égalité, le
 * plus petit identifiant) : des événements d'un même modèle qui se chevauchent ne s'ajoutent pas.
 */
export function strongestAt<T extends TimedEffect>(effects: readonly T[], at: Date): T | undefined {
  let best: T | undefined;
  for (const effect of effects) {
    if (effect.startsAt > at || effect.endsAt <= at) continue;
    if (!best) {
      best = effect;
      continue;
    }
    const gap = Math.abs(effect.deltaBps) - Math.abs(best.deltaBps);
    if (gap > 0 || (gap === 0 && effect.eventId < best.eventId)) best = effect;
  }
  return best;
}

export interface CycleYieldInput {
  /** Début du premier des cycles récoltés. */
  since: Date;
  cycleMinutes: number;
  /** Cycles récoltés, les premiers après `since`. */
  cycles: number;
  outputPerCycle: number;
  /** Événements de rendement du site (sa cité, son type de site). */
  effects: readonly TimedEffect[];
}

export interface CycleYield {
  quantity: number;
  /** Écart dû à chaque événement, en unités, signé : la quantité moins `cycles × outputPerCycle`. */
  byEvent: Map<string, number>;
}

/**
 * Rendement de cycles récoltés (4.3, 7.4). Un cycle se termine à `since + k × durée` ; s'il se termine pendant
 * un événement de rendement, il produit ⌊extrant × (10 000 + variation) ÷ 10 000⌋, avec l'événement le plus
 * fort en cours. Le calcul est fait cycle par cycle : récolter en une fois ou en plusieurs donne la même
 * quantité, et l'arrondi à l'unité inférieure ne dépend pas du moment de la récolte.
 */
export function cycleYield(input: CycleYieldInput): CycleYield {
  const { since, cycleMinutes, cycles, outputPerCycle, effects } = input;
  for (const [name, value] of Object.entries({ cycleMinutes, cycles, outputPerCycle }))
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError(`${name} must be a non-negative integer`);
  for (const { deltaBps } of effects)
    if (!Number.isSafeInteger(deltaBps) || deltaBps < -BPS || deltaBps > BPS)
      throw new RangeError(`Invalid yield variation ${deltaBps}`);
  if (!Number.isSafeInteger(cycles * outputPerCycle * 2))
    throw new RangeError('Yield is too large');
  const byEvent = new Map<string, number>();
  let quantity = cycles * outputPerCycle;
  if (effects.length === 0) return { quantity, byEvent };
  const cycleMs = cycleMinutes * 60_000;
  for (let k = 1; k <= cycles; k++) {
    const effect = strongestAt(effects, new Date(since.getTime() + k * cycleMs));
    if (!effect) continue;
    const produced = Math.floor((outputPerCycle * (BPS + effect.deltaBps)) / BPS);
    const gap = produced - outputPerCycle;
    if (gap === 0) continue;
    quantity += gap;
    byEvent.set(effect.eventId, (byEvent.get(effect.eventId) ?? 0) + gap);
  }
  return { quantity, byEvent };
}

/**
 * Durée d'un trajet qui part pendant une tempête de sa route (4.6, 7.4) : ⌈durée × (10 000 + ampleur) ÷ 10 000⌉
 * secondes, arrondie vers le haut comme la durée elle-même. Une tempête retarde, elle ne fait rien perdre.
 */
export function stormDurationSeconds(seconds: number, magnitudeBps: number): number {
  if (!Number.isSafeInteger(seconds) || seconds < 0)
    throw new RangeError('seconds must be a non-negative integer');
  if (!Number.isInteger(magnitudeBps) || magnitudeBps < 0 || magnitudeBps > BPS)
    throw new RangeError(`Invalid storm magnitude ${magnitudeBps}`);
  return Math.ceil((seconds * (BPS + magnitudeBps)) / BPS);
}

export interface DayEvent {
  goodId: string | null;
  startDay: number;
  endDay: number;
  magnitudeBps: number;
}

/**
 * Hausse de la demande des PNJ d'une cité pour chaque bien au jour de jeu donné, due aux caravanes en cours
 * (5.2, 7.4) : celle de la plus forte caravane du bien. Elle s'ajoute à celle des fêtes (`addBoosts`).
 */
export function caravanDemandBoosts(
  caravans: readonly DayEvent[],
  gameDay: number,
): Map<string, number> {
  const boosts = new Map<string, number>();
  for (const { goodId, startDay, endDay, magnitudeBps } of caravans) {
    if (goodId === null || gameDay < startDay || gameDay >= endDay) continue;
    boosts.set(goodId, Math.max(boosts.get(goodId) ?? 0, magnitudeBps));
  }
  return boosts;
}

/** Somme de deux tables de hausses par bien, en points de base. */
export function addBoosts(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): Map<string, number> {
  const sum = new Map(a);
  for (const [goodId, boost] of b) sum.set(goodId, (sum.get(goodId) ?? 0) + boost);
  return sum;
}

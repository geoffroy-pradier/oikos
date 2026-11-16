import { createRng } from './rng';

/**
 * Événements du monde (docs/specs/07-dieux-faveur-evenements.md, 7.3 et 7.4 ; 13 : aléa déterministe ; #267).
 * Calculs purs, en entiers : la planification d'un jour de jeu ne dépend que de sa graine, des règles en vigueur
 * et de la liste des cités et des routes ; les effets ne dépendent que des événements et de l'instant.
 *
 * Catalogue fermé, aligné sur `WORLD_EVENT_MODELS` de `@oikos/config` (dans le même ordre, qui est celui des
 * tirages) : l'effet de chaque modèle est fixé ici, la configuration n'en règle que les bornes.
 */
export const WORLD_EVENT_CATALOGUE = {
  /** Sécheresse : rendement des champs d'une cité réduit de l'ampleur. */
  drought: { scope: 'city', siteType: 'field', sign: -1 },
  /** Bonne année : rendement des vergers d'une cité accru de l'ampleur. */
  good_year: { scope: 'city', siteType: 'orchard', sign: 1 },
  /** Tempête : trajets qui partent sur une route allongés de l'ampleur ; rien n'est perdu. */
  storm: { scope: 'route', siteType: null, sign: 1 },
  /** Caravane étrangère : demande des PNJ d'une cité pour un bien accrue de l'ampleur. */
  caravan: { scope: 'city_good', siteType: null, sign: 1 },
} as const;
export type WorldEventKind = keyof typeof WORLD_EVENT_CATALOGUE;
const KINDS = Object.keys(WORLD_EVENT_CATALOGUE) as WorldEventKind[];

const BPS = 10_000;

export interface WorldEventRules {
  probabilityBps: number;
  minDays: number;
  maxDays: number;
  minMagnitudeBps: number;
  maxMagnitudeBps: number;
  /** Caravane seulement : les biens qu'elle peut demander. */
  goodIds?: readonly string[] | undefined;
}

export interface PlanningInput {
  /** Graine du jour, dérivée de celle du monde et du jour de jeu planifié. */
  daySeed: string;
  /** Jour de jeu planifié : celui où commencent les événements tirés. */
  startDay: number;
  /** Modèles en vigueur ; un modèle absent n'est jamais tiré. */
  models: { readonly [K in WorldEventKind]?: WorldEventRules | undefined };
  /** Cités du monde (identifiants courts de la configuration). L'ordre donné n'importe pas. */
  cities: readonly string[];
  /** Routes du monde, chacune entre deux cités de `cities`. L'ordre donné n'importe pas. */
  routes: readonly (readonly [string, string])[];
}

export interface PlannedWorldEvent {
  model: WorldEventKind;
  /** Cité visée ; pour une tempête, la première extrémité de la route dans l'ordre des identifiants. */
  cityId: string;
  /** Seconde extrémité de la route d'une tempête ; nulle sinon. */
  otherCityId: string | null;
  /** Bien d'une caravane ; nul sinon. */
  goodId: string | null;
  startDay: number;
  /** Premier jour de jeu qui n'est plus sous l'événement. */
  endDay: number;
  magnitudeBps: number;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Événements qui commencent au jour planifié. Chaque modèle tire de son propre générateur, initialisé par la
 * graine du jour et son nom : changer les règles d'un modèle ne change pas les tirages des autres. Un modèle
 * tire, dans cet ordre, s'il survient (un entier de [0, 9 999] sous sa probabilité), sa portée (cité, route,
 * puis bien pour une caravane), sa durée, puis son ampleur, chacun uniforme entre ses bornes comprises. Un
 * modèle à probabilité nulle, ou sans portée possible, ne tire rien. Au plus un événement par modèle et par jour.
 */
export function planWorldEvents(input: PlanningInput): PlannedWorldEvent[] {
  if (!Number.isSafeInteger(input.startDay)) throw new RangeError('Invalid start day');
  const cities = [...new Set(input.cities)].sort(byCodeUnit);
  const routes = [
    ...new Map(
      input.routes.map((route) => {
        const pair = [...route].sort(byCodeUnit) as [string, string];
        return [pair.join(' '), pair] as const;
      }),
    ).values(),
  ].sort((a, b) => byCodeUnit(a.join(' '), b.join(' ')));
  const planned: PlannedWorldEvent[] = [];
  for (const model of KINDS) {
    const rules = input.models[model];
    if (!rules || rules.probabilityBps <= 0) continue;
    const goods = [...new Set(rules.goodIds ?? [])].sort(byCodeUnit);
    const scope = WORLD_EVENT_CATALOGUE[model].scope;
    if (scope === 'route' ? routes.length === 0 : cities.length === 0) continue;
    if (scope === 'city_good' && goods.length === 0) continue;
    const rng = createRng(`${input.daySeed}:${model}`);
    if (rng.int(0, BPS - 1) >= rules.probabilityBps) continue;
    const [cityId, otherCityId] = scope === 'route' ? rng.pick(routes) : [rng.pick(cities), null];
    const goodId = scope === 'city_good' ? rng.pick(goods) : null;
    const days = rng.int(rules.minDays, rules.maxDays);
    const magnitudeBps = rng.int(rules.minMagnitudeBps, rules.maxMagnitudeBps);
    planned.push({
      model,
      cityId,
      otherCityId,
      goodId,
      startDay: input.startDay,
      endDay: input.startDay + days,
      magnitudeBps,
    });
  }
  return planned;
}

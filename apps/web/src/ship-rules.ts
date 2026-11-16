import {
  cityPortDuesCoefficientBps,
  DEFAULT_PORT_DUES,
  portDuesBaseOboles,
  routeProvisionsOboles,
  shipRoute,
  upkeepDailyObolesSchema,
} from '@oikos/config/schema';
import { departureCost, voyageDurationSeconds } from '@oikos/sim';
import { z } from 'zod';

const name = z.string().min(1);
const positiveInt = z.number().int().positive();
const fee = z.number().int().nonnegative();
/**
 * Ce que le client lit des règles du transport (vue `public.ship_rules`, section `ships` de la
 * configuration en vigueur). Schéma souple sur la forme, comme `site-rules.ts` : un champ nouveau reste
 * lisible. Les valeurs sont tenues : un prix, une durée ou une vitesse qui ne sont pas des entiers
 * positifs font échouer la lecture. L'API fait foi ; le client ne s'en sert que pour proposer et annoncer.
 */
const shipsSchema = z.object({
  classes: z.array(
    z.object({
      id: name,
      capacityUnits: positiveInt,
      speedBps: positiveInt,
      purchaseCostOboles: positiveInt,
      dailyUpkeepOboles: upkeepDailyObolesSchema.default(0),
    }),
  ),
  // Version publiée avant les voyages : aucune route, aucun droit de port, comme pour l'API.
  routes: z
    .array(
      z.object({
        cities: z.tuple([name, name]),
        hours: positiveInt,
        provisionsOboles: z.record(name, fee),
      }),
    )
    .default([]),
  portDues: z
    .object({
      byClassOboles: z.record(name, fee),
      burnShareBps: z.number().int().min(0).max(10_000),
      cityCoefficientBps: z.record(name, fee),
    })
    .default(DEFAULT_PORT_DUES),
});
export type ShipRules = z.infer<typeof shipsSchema>;
export type ShipClassRule = ShipRules['classes'][number];

/**
 * Règles du transport lues dans la ligne de `ship_rules`. Section absente (version publiée avant le
 * transport) : aucune classe, aucune route. `null` si la ligne est illisible : l'écran annonce un échec.
 */
export function parseShipRules(row: unknown): ShipRules | null {
  const ships = (row as { ships?: unknown } | null)?.ships ?? null;
  if (ships === null) return { classes: [], routes: [], portDues: DEFAULT_PORT_DUES };
  const parsed = shipsSchema.safeParse(ships);
  return parsed.success ? parsed.data : null;
}

/** Cités reliées à `fromSlug` par une route, avec la durée de référence en heures, triées par durée. */
export function destinationsFrom(rules: ShipRules, fromSlug: string) {
  return rules.routes
    .flatMap(({ cities: [a, b], hours }) => {
      if (a === fromSlug) return [{ slug: b, hours }];
      if (b === fromSlug) return [{ slug: a, hours }];
      return [];
    })
    .sort((left, right) => left.hours - right.hours || left.slug.localeCompare(right.slug));
}

export interface DepartureQuote {
  provisionsOboles: number;
  portDuesOboles: number;
  totalOboles: number;
  /** Durée du trajet pour cette classe, en secondes (arrondie à la seconde supérieure, comme l'API). */
  durationSeconds: number;
}

/**
 * Coût et durée d'un départ, calculés comme l'API (`voyage.depart`) : provisions de la route pour la
 * classe, plus droit de port de la cité d'arrivée. `null` sans route ou pour une classe inconnue.
 */
export function quoteDeparture(
  rules: ShipRules,
  classId: string,
  fromSlug: string,
  toSlug: string,
): DepartureQuote | null {
  const shipClass = rules.classes.find((candidate) => candidate.id === classId);
  const config = { ships: rules };
  const route = shipRoute(config, fromSlug, toSlug);
  if (!shipClass || !route) return null;
  const cost = departureCost({
    provisionsOboles: routeProvisionsOboles(route, classId),
    portDuesBaseOboles: portDuesBaseOboles(config, classId),
    cityCoefficientBps: cityPortDuesCoefficientBps(config, toSlug),
    burnShareBps: rules.portDues.burnShareBps,
  });
  return {
    provisionsOboles: cost.provisionsOboles,
    portDuesOboles: cost.portDues.oboles,
    totalOboles: cost.totalOboles,
    durationSeconds: voyageDurationSeconds(route.hours, shipClass.speedBps),
  };
}

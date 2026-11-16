import { z } from 'zod';
import type { CityLabor } from './labor';
import type { Lease, MyProperty, PropertySize } from './property';

/** Une alerte du tableau de bord sur le personnel et l'immobilier (#259). */
export type HouseAlert =
  | { kind: 'unhoused'; workers: number }
  | { kind: 'renovate'; property: MyProperty }
  | { kind: 'unpaid'; property: MyProperty }
  | { kind: 'leaseTerminated'; lease: Lease };

/**
 * Alertes de la maison : travailleurs sans logement là où l'hébergement coûte (`unhoused`), biens dont
 * l'entretien est impayé ou dont l'état est passé sous le seuil où ils ne logent plus personne (« à
 * rénover »), et baux résiliés pour loyer impayé à la dernière clôture (`lastCloseDay`, jour de jeu).
 */
export function houseAlerts(input: {
  unhoused: number;
  properties: readonly MyProperty[];
  sizes: ReadonlyMap<string, PropertySize>;
  leases: readonly Lease[];
  lastCloseDay: number | null;
}): HouseAlert[] {
  const alerts: HouseAlert[] = [];
  if (input.unhoused > 0) alerts.push({ kind: 'unhoused', workers: input.unhoused });
  for (const property of input.properties) {
    if (property.unpaidSince !== null) alerts.push({ kind: 'unpaid', property });
    const size = input.sizes.get(property.sizeId);
    if (size && property.condition < size.minHabitableCondition)
      alerts.push({ kind: 'renovate', property });
  }
  for (const lease of input.leases) {
    if (
      lease.endReason === 'unpaid' &&
      lease.endedDay !== null &&
      lease.endedDay === input.lastCloseDay
    )
      alerts.push({ kind: 'leaseTerminated', lease });
  }
  return alerts;
}

/**
 * Travailleurs sans logement des sites de la maison (vue `my_workforce`), comptés dans les cités où une
 * nuit d'hébergement coûte au prix du jour (`labor`). `null` si une ligne est illisible.
 */
export function parseUnhoused(rows: unknown, labor: ReadonlyMap<string, CityLabor>): number | null {
  const row = z.object({ city_id: z.string(), unhoused: z.number().int().nonnegative() });
  const parsed = z.array(row).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .filter((site) => (labor.get(site.city_id)?.lodgingOboles ?? 0) > 0)
    .reduce((sum, site) => sum + site.unhoused, 0);
}

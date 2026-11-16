import type { Lease, MyProperty, PropertySize } from './property';

/** Une alerte du tableau de bord sur le personnel et l'immobilier (#259). */
export type HouseAlert =
  | { kind: 'unhoused'; workers: number }
  | { kind: 'renovate'; property: MyProperty }
  | { kind: 'unpaid'; property: MyProperty }
  | { kind: 'leaseTerminated'; lease: Lease };

/** Un bail résilié est signalé pendant un jour après sa fin : assez pour être vu, sans rester à vie. */
export const TERMINATED_LEASE_NOTICE_MS = 24 * 60 * 60 * 1000;

/**
 * Alertes de la maison : travailleurs sans logement (somme de `my_workforce`), biens dont l'entretien est
 * impayé ou dont l'état est passé sous le seuil où ils ne logent plus personne (« à rénover »), et baux
 * résiliés pour loyer impayé depuis moins d'un jour (`now`, heure du serveur).
 */
export function houseAlerts(input: {
  unhoused: number;
  properties: readonly MyProperty[];
  sizes: ReadonlyMap<string, PropertySize>;
  leases: readonly Lease[];
  now: number;
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
    const ended = lease.endedAt === null ? Number.NaN : Date.parse(lease.endedAt);
    if (lease.endReason === 'unpaid' && input.now - ended < TERMINATED_LEASE_NOTICE_MS)
      alerts.push({ kind: 'leaseTerminated', lease });
  }
  return alerts;
}

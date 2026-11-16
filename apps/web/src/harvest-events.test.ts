import { describe, expect, it } from 'vitest';
import { harvestUnderEvents, yieldEventsOf, yieldGaps } from './harvest-events';
import type { SiteRecipe } from './site-rules';
import type { WorldEvent } from './world-events';

// Un champ de 10 unités par cycle d'une heure ; cycles finis à 1 h, 2 h et 3 h.
const field: SiteRecipe = {
  id: 'grow_wheat',
  siteType: 'field',
  inputs: [],
  outputs: [{ goodId: 'wheat', quantity: 10 }],
  durationMinutes: 60,
  maxAccruedCycles: 10,
  workers: 0,
};
const at = (hour: number) => new Date(Date.UTC(2026, 5, 1, hour));
const drought = (id: string, from: number, to: number, magnitudeBps: number): WorldEvent => ({
  id,
  model: 'drought',
  cityId: 'c1',
  otherCityId: null,
  goodId: null,
  startsAt: at(from),
  endsAt: at(to),
  magnitudeBps,
});

describe('récolte estimée sous les événements de rendement (#417)', () => {
  it('seuls les événements de la cité du site et du modèle de son type comptent', () => {
    const other = { ...drought('e2', 0, 5, 5_000), cityId: 'c2' };
    const goodYear = { ...drought('e3', 0, 5, 5_000), model: 'good_year' as const };
    const events = [drought('e1', 0, 5, 5_000), other, goodYear];
    expect(yieldEventsOf(events, 'c1', 'field').map((event) => event.id)).toEqual(['e1']);
    expect(yieldEventsOf(events, 'c1', 'orchard').map((event) => event.id)).toEqual(['e3']);
    expect(yieldEventsOf(events, 'c1', 'workshop')).toEqual([]);
  });

  it('sécheresses qui se chevauchent : la plus forte en cours à la fin de chaque cycle, sans cumul', () => {
    // Cycle de 1 h : aucune ; 2 h : 30 % → 7 ; 3 h : 30 % et 60 % → 4 (pas 1).
    const events = [drought('e1', 2, 5, 3_000), drought('e2', 3, 5, 6_000)];
    expect(harvestUnderEvents(field, 3, at(0), events)).toEqual({
      outputs: [{ goodId: 'wheat', quantity: 21 }],
      gaps: [{ goodId: 'wheat', quantity: -9 }],
    });
  });

  it('sans écart, aucune explication ; un extrant absent de la réponse compte pour zéro', () => {
    expect(yieldGaps(field, 3, [{ goodId: 'wheat', quantity: 30 }])).toEqual([]);
    expect(yieldGaps(field, 3, [])).toEqual([{ goodId: 'wheat', quantity: -30 }]);
  });
});

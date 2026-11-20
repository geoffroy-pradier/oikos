import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { describe, expect, it } from 'vitest';
import {
  destinationsFrom,
  parseShipRules,
  quoteDeparture,
  withCityCoefficients,
} from './ship-rules';

const SHIPS = (INITIAL_CONFIG as GameConfig).ships;
const initial = () => {
  const rules = parseShipRules({ ships: SHIPS });
  if (!rules) throw new Error('initial ship rules must parse');
  return rules;
};

describe('règles du transport lues par le client', () => {
  it('la configuration initiale se lit ; une version sans transport ne propose rien', () => {
    expect(initial().classes.map((row) => row.id)).toEqual(['coaster', 'round_ship']);
    for (const row of [null, {}, { ships: null }])
      expect(parseShipRules(row)).toMatchObject({ classes: [], routes: [] });
  });

  it('une version sans routes ni droit de port reste lisible : aucun départ', () => {
    const rules = parseShipRules({ ships: { classes: SHIPS.classes } });
    expect(rules?.routes).toEqual([]);
    expect(rules && quoteDeparture(rules, 'coaster', 'kalliste', 'elaia')).toBeNull();
  });

  it('une valeur fausse fait échouer la lecture, jamais un prix inventé', () => {
    const [coaster] = SHIPS.classes;
    for (const purchaseCostOboles of [0, -1, 2.5, '2400'])
      expect(
        parseShipRules({ ships: { classes: [{ ...coaster, purchaseCostOboles }], routes: [] } }),
      ).toBeNull();
  });

  it('destinations : les routes de la cité, dans un sens ou l’autre, des plus courtes aux plus longues', () => {
    expect(destinationsFrom(initial(), 'kalliste')).toEqual([
      { slug: 'dikaia', hours: 3 },
      { slug: 'emporion', hours: 3 },
      { slug: 'ampelos', hours: 4 },
      { slug: 'elaia', hours: 4 },
      { slug: 'myrrhine', hours: 4 },
      { slug: 'halos', hours: 6 },
    ]);
    expect(destinationsFrom(initial(), 'halos').map(({ slug }) => slug)).toEqual([
      'chalkeia',
      'emporion',
      'gamelia',
      'ampelos',
      'kalliste',
      'elaia',
    ]);
    // Une cité de #706 n'a que ses voisines (#707) : un trajet lointain passe par une escale.
    expect(destinationsFrom(initial(), 'gamelia')).toEqual([
      { slug: 'halos', hours: 3 },
      { slug: 'emporion', hours: 4 },
      { slug: 'elaia', hours: 5 },
    ]);
    expect(destinationsFrom(initial(), 'atlantis')).toEqual([]);
  });

  it('coût d’un départ calculé comme l’API : provisions plus droit de port, arrondis vers le haut', () => {
    const rules = initial();
    // Configuration initiale (#668) : les provisions de la route et le droit de port d'Elaia ; un navire rond est
    // plus lent.
    expect(quoteDeparture(rules, 'coaster', 'kalliste', 'elaia')).toEqual({
      provisionsOboles: 4,
      portDuesOboles: 18,
      totalOboles: 22,
      durationSeconds: 4 * 3600,
    });
    expect(quoteDeparture(rules, 'round_ship', 'elaia', 'kalliste')?.durationSeconds).toBe(19_200);
    const priced = {
      ...rules,
      routes: rules.routes.map((route) => ({ ...route, provisionsOboles: { coaster: 7 } })),
      portDues: {
        byClassOboles: { coaster: 10 },
        burnShareBps: 5000,
        cityCoefficientBps: { elaia: 12_500 },
      },
    };
    // Droit : ⌈10 × 1,25⌉ = 13 ; total 20.
    expect(quoteDeparture(priced, 'coaster', 'kalliste', 'elaia')).toMatchObject({
      provisionsOboles: 7,
      portDuesOboles: 13,
      totalOboles: 20,
    });
    expect(quoteDeparture(priced, 'galley', 'kalliste', 'elaia')).toBeNull();
    expect(quoteDeparture(priced, 'coaster', 'kalliste', 'kalliste')).toBeNull();
  });

  it('droit de port en vigueur : le coefficient de chaque cité du monde, lu dans `city_rates` (#262)', () => {
    const priced = {
      ...initial(),
      portDues: { byClassOboles: { coaster: 10 }, burnShareBps: 5000, cityCoefficientBps: {} },
    };
    const slugs = new Map([
      ['e1', 'elaia'],
      ['k1', 'kalliste'],
    ]);
    // Elaia a décrété ×1,5 ; la cité homonyme d'un autre monde (e2) ne compte pas.
    const inForce = withCityCoefficients(
      priced,
      [
        { city_id: 'e1', port_dues_coefficient_bps: 15_000 },
        { city_id: 'e2', port_dues_coefficient_bps: 50_000 },
      ],
      slugs,
    );
    expect(inForce?.portDues.cityCoefficientBps).toEqual({ elaia: 15_000 });
    expect(inForce && quoteDeparture(inForce, 'coaster', 'kalliste', 'elaia')?.portDuesOboles).toBe(
      15,
    );
    // Sans ligne, la configuration ; une ligne illisible : inconnu, jamais le coefficient ×1 supposé.
    expect(withCityCoefficients(priced, [], slugs)).toEqual(priced);
    for (const bad of [
      null,
      [{ city_id: 'e1' }],
      [{ city_id: 'e1', port_dues_coefficient_bps: 1.5 }],
    ])
      expect(withCityCoefficients(priced, bad, slugs)).toBeNull();
  });
});

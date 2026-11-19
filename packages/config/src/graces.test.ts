import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, validateConfig, type Grace } from './index';

const base = () =>
  structuredClone(INITIAL_CONFIG) as Record<string, unknown> & { gods: { id: string }[] };
/** Grâces d'essai, distinctes de celles de la configuration initiale. */
const GRACES: Grace[] = [
  {
    id: 'demeter_harvest',
    godId: 'demeter',
    effect: 'blessed_harvest',
    magnitudeBps: 2_000,
    charisRequired: 300,
    charisSpent: 150,
    cooldownDays: 3,
  },
  {
    id: 'apollo_wind',
    godId: 'apollo',
    effect: 'fair_wind',
    magnitudeBps: 2_500,
    charisRequired: 300,
    charisSpent: 150,
    cooldownDays: 3,
  },
];
const errorsOf = (graces: unknown) => {
  const result = validateConfig({ ...base(), graces });
  return result.ok ? [] : result.errors;
};
const fieldsOf = (graces: unknown) => [
  ...new Set(errorsOf(graces).map((error) => error.split(':')[0])),
];
const grace = (patch: Partial<Record<keyof Grace, unknown>>) => [{ ...GRACES[0], ...patch }];

describe('grâces (7.1, #266)', () => {
  it('la configuration initiale offre une grâce par dieu concerné, calibrée (#668) ; des grâces d’essai sont admises', () => {
    const result = validateConfig(INITIAL_CONFIG);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const { graces, recipes, ships, clock } = result.config;
    expect(graces.map((each) => [each.godId, each.effect])).toEqual([
      ['demeter', 'blessed_harvest'],
      ['athena', 'inspired_workshop'],
      ['poseidon', 'fair_wind'],
    ]);
    for (const each of graces) {
      // On dépense la moitié de la Charis requise : invoquer suppose une faveur entretenue, pas une offrande d'un jour.
      expect(each.charisSpent * 2).toBe(each.charisRequired);
      // Une grâce ajoute toujours quelque chose (7.1) : au moins une unité au plus petit extrant d'un cycle de son effet,
      // au moins une seconde au plus court des trajets.
      const smallest = (workshop: boolean) =>
        Math.min(
          ...recipes
            .filter((recipe) => recipe.inputs.length > 0 === workshop)
            .flatMap((recipe) => recipe.outputs.map((stack) => stack.quantity)),
        );
      const shortest = Math.min(...ships.routes.map((route) => route.hours)) * 3_600;
      const added =
        each.effect === 'fair_wind'
          ? Math.floor((shortest * each.magnitudeBps) / 10_000)
          : Math.floor(
              (smallest(each.effect === 'inspired_workshop') * each.magnitudeBps) / 10_000,
            );
      expect(added).toBeGreaterThanOrEqual(1);
    }
    // Une récolte bénie et un atelier inspiré par saison ; un vent favorable, moins cher, tous les trois jours.
    const [harvest, workshop, wind] = graces;
    expect([harvest?.cooldownDays, workshop?.cooldownDays]).toEqual([
      clock.seasonDays,
      clock.seasonDays,
    ]);
    expect(wind?.cooldownDays).toBeLessThan(clock.seasonDays);
    expect(wind?.charisSpent).toBeLessThan(harvest?.charisSpent ?? 0);
    expect(errorsOf(GRACES)).toEqual([]);
  });

  it('une version publiée avant les grâces reste lisible, sans grâce', () => {
    const older: Record<string, unknown> = base();
    delete older['graces'];
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.graces).toEqual([]);
  });

  it('champs bornés, effet du catalogue', () => {
    for (const patch of [
      { effect: 'thunderbolt' },
      { magnitudeBps: 0 },
      { magnitudeBps: 10_001 },
      { magnitudeBps: 1.5 },
      { charisRequired: 150.5 },
      { charisRequired: Number.MAX_SAFE_INTEGER + 1 },
      { charisSpent: -1 },
      { cooldownDays: 0 },
      { cooldownDays: 367 },
      { id: 'Zeus' },
    ])
      expect([patch, fieldsOf(grace(patch))]).toEqual([
        patch,
        [`graces[0].${Object.keys(patch)[0] ?? ''}`],
      ]);
    expect(fieldsOf(grace({ extra: 1 } as never))).toEqual(['graces[0]']);
  });

  it('bornes atteintes : récolte doublée, trajet deux fois plus court, Charis dépensée = requise, gratuite', () => {
    expect(errorsOf(grace({ effect: 'blessed_harvest', magnitudeBps: 10_000 }))).toEqual([]);
    expect(errorsOf(grace({ effect: 'inspired_workshop', magnitudeBps: 10_000 }))).toEqual([]);
    expect(errorsOf(grace({ effect: 'fair_wind', magnitudeBps: 5_000 }))).toEqual([]);
    expect(errorsOf(grace({ charisRequired: 0, charisSpent: 0, cooldownDays: 366 }))).toEqual([]);
    expect(errorsOf(grace({ charisRequired: 150, charisSpent: 150 }))).toEqual([]);
  });

  it('un vent au-delà de la moitié, une dépense au-delà du requis, un dieu inconnu, un doublon : refusés', () => {
    expect(errorsOf(grace({ effect: 'fair_wind', magnitudeBps: 5_001 }))).toEqual([
      'graces[0].magnitudeBps: at most 5000 for fair_wind',
    ]);
    expect(errorsOf(grace({ charisRequired: 149, charisSpent: 150 }))).toEqual([
      'graces[0].charisSpent: above the Charis required',
    ]);
    expect(errorsOf(grace({ godId: 'zeus' }))).toEqual(['graces[0].godId: unknown god "zeus"']);
    expect(errorsOf([...GRACES, { ...GRACES[1], effect: 'blessed_harvest' }])).toEqual([
      'graces: duplicate id "apollo_wind"',
    ]);
    // Un dieu retiré de la configuration doit l'être aussi de ses grâces (Apollon ne protège aucune cité), et de
    // la Pythie (#270).
    const godless = {
      ...base(),
      gods: base().gods.filter((god) => god.id !== 'apollo'),
      graces: GRACES,
    };
    const result = validateConfig(godless);
    expect(result.ok ? [] : result.errors).toEqual([
      'graces[1].godId: unknown god "apollo"',
      'oracle.godId: unknown god "apollo"',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, validateConfig, type Grace } from './index';

const base = () => structuredClone(INITIAL_CONFIG) as Record<string, unknown> & { graces: Grace[] };
const errorsOf = (graces: unknown) => {
  const result = validateConfig({ ...base(), graces });
  return result.ok ? [] : result.errors;
};
const fieldsOf = (graces: unknown) => [
  ...new Set(errorsOf(graces).map((error) => error.split(':')[0])),
];
const grace = (patch: Partial<Record<keyof Grace, unknown>>) => [{ ...base().graces[0], ...patch }];

describe('grâces (7.1, #266)', () => {
  it('la configuration initiale : un effet par dieu de son domaine, bornés', () => {
    const result = validateConfig(INITIAL_CONFIG);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.graces.map((row) => [row.id, row.godId, row.effect])).toEqual([
      ['demeter_harvest', 'demeter', 'blessed_harvest'],
      ['athena_inspiration', 'athena', 'inspired_workshop'],
      ['poseidon_wind', 'poseidon', 'fair_wind'],
    ]);
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
    const graces = base().graces;
    expect(errorsOf([...graces, { ...graces[2], effect: 'blessed_harvest' }])).toEqual([
      'graces: duplicate id "poseidon_wind"',
    ]);
    // Un dieu retiré de la configuration doit l'être aussi de ses grâces.
    expect(validateConfig({ ...base(), gods: [] }).ok).toBe(false);
  });
});

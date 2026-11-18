import { describe, expect, it } from 'vitest';
import {
  INITIAL_CONFIG,
  stewardDailyWageOboles,
  stewardLimit,
  stewardOperationsPerTick,
  stewardRulesLimit,
  validateConfig,
  type StewardsRules,
} from './index';

type Config = Record<string, unknown> & { stewards: StewardsRules };
const base = () => structuredClone(INITIAL_CONFIG) as Config;
const fieldsOf = (stewards: unknown) => {
  const result = validateConfig({ ...base(), stewards });
  return result.ok ? [] : [...new Set(result.errors.map((error) => error.split(':')[0]))];
};

describe('intendants (4.4, #278)', () => {
  it('la configuration initiale ouvre des postes, sans salaire, avec des noms à tirer', () => {
    const result = validateConfig(INITIAL_CONFIG);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(stewardLimit(result.config)).toBeGreaterThan(0);
    // Paramètres neutres (#278) : le salaire entre à zéro, en attendant le calibrage.
    expect(stewardDailyWageOboles(result.config)).toBe(0);
    expect(stewardRulesLimit(result.config)).toBeGreaterThanOrEqual(3);
    expect(result.config.stewards?.names.length).toBeGreaterThan(stewardLimit(result.config));
  });

  it('une version publiée avant les intendants reste lisible : aucun poste, aucun salaire, aucune règle', () => {
    const older: Record<string, unknown> = base();
    delete older['stewards'];
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.stewards).toBeUndefined();
    expect(stewardLimit(result.config)).toBe(0);
    expect(stewardDailyWageOboles(result.config)).toBe(0);
    expect(stewardRulesLimit(result.config)).toBe(0);
  });

  it('chaque nombre est un entier borné ; aucun champ inconnu', () => {
    const stewards = base().stewards;
    expect(fieldsOf(stewards)).toEqual([]);
    for (const [key, value] of [
      ['dailyWageOboles', -1],
      ['dailyWageOboles', 0.5],
      ['dailyWageOboles', 1_000_000_001],
      ['rulesPerSteward', 0],
      ['rulesPerSteward', 21],
      ['limitByHeadquartersLevel', []],
      ['limitByHeadquartersLevel', Array.from({ length: 11 }, () => 1)],
      ['names', []],
    ] as const)
      expect(fieldsOf({ ...stewards, [key]: value })).toEqual([`stewards.${key}`]);
    expect(fieldsOf({ ...stewards, limitByHeadquartersLevel: [-1] })).toEqual([
      'stewards.limitByHeadquartersLevel[0]',
    ]);
    expect(fieldsOf({ ...stewards, hidden: 1 })).toEqual(['stewards']);
    expect(fieldsOf({ ...stewards, limitByHeadquartersLevel: [0], rulesPerSteward: 20 })).toEqual(
      [],
    );
  });

  it('des noms uniques, non vides, sans espace autour', () => {
    const stewards = base().stewards;
    for (const names of [['Nikias', 'Nikias'], [''], [' Nikias'], ['x'.repeat(41)]])
      expect(fieldsOf({ ...stewards, names })).toEqual([
        names.length === 2 ? 'stewards.names[1]' : 'stewards.names[0]',
      ]);
    expect(fieldsOf({ ...stewards, names: ['Kléon d’Athènes'] })).toEqual([]);
  });

  it('opérations par tick (#279) : une au départ, une pour une version publiée avant elles, entier de 1 à 20', () => {
    const initial = validateConfig(INITIAL_CONFIG);
    if (!initial.ok) throw new Error(initial.errors.join('\n'));
    expect(stewardOperationsPerTick(initial.config)).toBe(1);
    const older: Record<string, unknown> = { ...base().stewards };
    delete older['operationsPerTick'];
    const result = validateConfig({ ...base(), stewards: older });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.stewards?.operationsPerTick).toBe(1);
    const stewards = base().stewards;
    for (const value of [0, 21, 1.5, '1'])
      expect(fieldsOf({ ...stewards, operationsPerTick: value })).toEqual([
        'stewards.operationsPerTick',
      ]);
    expect(fieldsOf({ ...stewards, operationsPerTick: 20 })).toEqual([]);
    const without: Record<string, unknown> = base();
    delete without['stewards'];
    const none = validateConfig(without);
    if (!none.ok) throw new Error(none.errors.join('\n'));
    expect(stewardOperationsPerTick(none.config)).toBe(0);
  });
});

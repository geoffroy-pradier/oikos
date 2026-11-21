import { describe, expect, it } from 'vitest';
import {
  INITIAL_CONFIG,
  stewardDailyWageOboles,
  stewardLimit,
  stewardOperationsPerTick,
  stewardOperationsRetentionDays,
  stewardRefusalRestTicks,
  stewardRulesLimit,
  validateConfig,
  type StewardsRules,
} from './index';

type Config = Record<string, unknown> & { stewards: StewardsRules };
const base = () => structuredClone(INITIAL_CONFIG) as Config;
/** Une version publiée avant les intendants : ni eux, ni les maisons PNJ (#715) ni leur retrait (#717), venus après. */
const beforeStewards = (config: Record<string, unknown>) => {
  delete config['stewards'];
  delete config['npcHouses'];
  delete config['npcRetreat'];
};
const fieldsOf = (stewards: unknown) => {
  const result = validateConfig({ ...base(), stewards });
  return result.ok ? [] : [...new Set(result.errors.map((error) => error.split(':')[0]))];
};

describe('intendants (4.4, #278)', () => {
  it('la configuration initiale ouvre des postes, au salaire de deux travailleurs, avec des noms à tirer', () => {
    const result = validateConfig(INITIAL_CONFIG);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(stewardLimit(result.config)).toBeGreaterThan(0);
    // Calibrage (#668) : un intendant, qui mène un site et ses ventes, est payé le double d'un travailleur de chaque cité.
    for (const wage of Object.values(result.config.staff.dailyWageOboles))
      expect(stewardDailyWageOboles(result.config)).toBe(2 * wage);
    expect(stewardRulesLimit(result.config)).toBeGreaterThanOrEqual(3);
    expect(result.config.stewards?.names.length).toBeGreaterThan(stewardLimit(result.config));
  });

  it('une version publiée avant les intendants reste lisible : aucun poste, aucun salaire, aucune règle', () => {
    const older: Record<string, unknown> = base();
    beforeStewards(older);
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
    beforeStewards(without);
    const none = validateConfig(without);
    if (!none.ok) throw new Error(none.errors.join('\n'));
    expect(stewardOperationsPerTick(none.config)).toBe(0);
  });

  it('conservation des opérations (#561) : 30 jours au départ et pour une version publiée avant elle, entier de 1 à 3650', () => {
    const initial = validateConfig(INITIAL_CONFIG);
    if (!initial.ok) throw new Error(initial.errors.join('\n'));
    expect(stewardOperationsRetentionDays(initial.config)).toBe(30);
    const older: Record<string, unknown> = { ...base().stewards };
    delete older['operationsRetentionDays'];
    const result = validateConfig({ ...base(), stewards: older });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(stewardOperationsRetentionDays(result.config)).toBe(30);
    const stewards = base().stewards;
    for (const value of [0, 3651, 1.5, '30'])
      expect(fieldsOf({ ...stewards, operationsRetentionDays: value })).toEqual([
        'stewards.operationsRetentionDays',
      ]);
    expect(fieldsOf({ ...stewards, operationsRetentionDays: 1 })).toEqual([]);
    // Sans intendants, les opérations d'une version antérieure se purgent encore, à la valeur d'avant le paramètre.
    const without: Record<string, unknown> = base();
    beforeStewards(without);
    const none = validateConfig(without);
    if (!none.ok) throw new Error(none.errors.join('\n'));
    expect(stewardOperationsRetentionDays(none.config)).toBe(30);
  });

  it('repos d’une règle refusée (#621) : 5 ticks au départ, aucun pour une version publiée avant lui, entier de 0 à 1000', () => {
    const initial = validateConfig(INITIAL_CONFIG);
    if (!initial.ok) throw new Error(initial.errors.join('\n'));
    expect(stewardRefusalRestTicks(initial.config)).toBe(5);
    const older: Record<string, unknown> = { ...base().stewards };
    delete older['refusalRestTicks'];
    const result = validateConfig({ ...base(), stewards: older });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    // Une version publiée garde son comportement : le repos s'active en publiant une version qui le règle.
    expect(stewardRefusalRestTicks(result.config)).toBe(0);
    const stewards = base().stewards;
    for (const value of [-1, 1001, 0.5, '5'])
      expect(fieldsOf({ ...stewards, refusalRestTicks: value })).toEqual([
        'stewards.refusalRestTicks',
      ]);
    // 0 : une règle refusée est retentée à chaque opération, comme avant ce paramètre.
    expect(fieldsOf({ ...stewards, refusalRestTicks: 0 })).toEqual([]);
    expect(fieldsOf({ ...stewards, refusalRestTicks: 1000 })).toEqual([]);
    const without: Record<string, unknown> = base();
    beforeStewards(without);
    const none = validateConfig(without);
    if (!none.ok) throw new Error(none.errors.join('\n'));
    expect(stewardRefusalRestTicks(none.config)).toBe(0);
  });
});

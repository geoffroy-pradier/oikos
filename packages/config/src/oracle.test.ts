import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, validateConfig, type OracleRules } from './index';

type Config = Record<string, unknown> & {
  oracle: OracleRules;
  gods: { id: string; charisPerObole: number }[];
};
const base = () => structuredClone(INITIAL_CONFIG) as Config;
const errorsOf = (config: Config) => {
  const result = validateConfig(config);
  return result.ok ? [] : result.errors;
};
const fieldsOf = (oracle: unknown) => [
  ...new Set(errorsOf({ ...base(), oracle } as Config).map((error) => error.split(':')[0])),
];

describe('la Pythie (7.3, #270)', () => {
  it('la configuration initiale fait consulter Apollon, qui accepte la monnaie, à un prix en oboles entières', () => {
    const result = validateConfig(INITIAL_CONFIG);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const oracle = result.config.oracle;
    expect(oracle?.godId).toBe('apollo');
    expect(Number.isSafeInteger(oracle?.consultationOboles)).toBe(true);
    expect(oracle?.consultationOboles).toBeGreaterThan(0);
    const apollo = result.config.gods.find((god) => god.id === 'apollo');
    expect(apollo?.charisPerObole).toBeGreaterThan(0);
  });

  it('une version publiée avant la Pythie reste lisible, sans consultation', () => {
    const older: Record<string, unknown> = base();
    delete older['oracle'];
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.oracle).toBeUndefined();
  });

  it('prix et longueur bornés, en entiers ; aucun champ inconnu', () => {
    const oracle = base().oracle;
    expect(fieldsOf(oracle)).toEqual([]);
    for (const [key, value] of [
      ['consultationOboles', 0],
      ['consultationOboles', 1.5],
      ['consultationOboles', 1_000_000_001],
      ['maxTextLength', 79],
      ['maxTextLength', 1_001],
      ['godId', 'Apollo'],
    ] as const)
      expect(fieldsOf({ ...oracle, [key]: value })).toEqual([`oracle.${key}`]);
    expect(fieldsOf({ ...oracle, hidden: 1 })).toEqual(['oracle']);
    expect(fieldsOf({ ...oracle, consultationOboles: 1 })).toEqual([]);
  });

  it('le dieu de la Pythie est connu et accepte la monnaie', () => {
    expect(fieldsOf({ ...base().oracle, godId: 'hades' })).toEqual(['oracle.godId']);
    const config = base();
    const apollo = config.gods.find((god) => god.id === 'apollo');
    if (!apollo) throw new Error('apollo');
    apollo.charisPerObole = 0;
    expect(errorsOf(config)).toEqual(['oracle.godId: god "apollo" does not accept money']);
  });
});

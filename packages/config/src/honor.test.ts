import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, validateConfig, type HonorRules } from './index';

type Config = Record<string, unknown> & { honor: HonorRules };
const base = () => structuredClone(INITIAL_CONFIG) as Config;
const fieldsOf = (honor: unknown) => {
  const result = validateConfig({ ...base(), honor });
  return result.ok ? [] : [...new Set(result.errors.map((error) => error.split(':')[0]))];
};

describe('la Timè (4.1, #704)', () => {
  it('la configuration initiale borne la Timè autour de zéro, sans aucun gain ni perte', () => {
    const result = validateConfig(INITIAL_CONFIG);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const honor = result.config.honor;
    expect(honor?.min).toBeLessThan(0);
    expect(honor?.max).toBeGreaterThan(0);
    expect(Object.values(honor?.changes ?? { missing: 1 })).toEqual([0]);
  });

  it('une version publiée avant la Timè reste lisible, sans Timè', () => {
    const older: Record<string, unknown> = base();
    delete older['honor'];
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.honor).toBeUndefined();
  });

  it('bornes et variations entières et bornées, zéro entre les bornes ; aucun champ ni motif inconnu', () => {
    const honor = base().honor;
    expect(fieldsOf(honor)).toEqual([]);
    for (const [patch, field] of [
      [{ min: 1 }, 'honor.min'],
      [{ min: -1.5 }, 'honor.min'],
      [{ min: -1_000_000_001 }, 'honor.min'],
      [{ max: -1 }, 'honor.max'],
      [{ max: 1_000_000_001 }, 'honor.max'],
      [{ min: 0, max: 0 }, 'honor.max'],
      [{ changes: { archon_term: -1 } }, 'honor.changes.archon_term'],
      [{ changes: { archon_term: 0.5 } }, 'honor.changes.archon_term'],
      [{ changes: { archon_term: 0, loan_default: -5 } }, 'honor.changes'],
      [{ changes: {} }, 'honor.changes.archon_term'],
      [{ hidden: 1 }, 'honor'],
    ] as const)
      expect(fieldsOf({ ...honor, ...patch })).toEqual([field]);
    expect(fieldsOf({ min: 0, max: 1, changes: { archon_term: 1_000_000_000 } })).toEqual([]);
  });
});

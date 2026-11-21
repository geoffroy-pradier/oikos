import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_SPLENDOR_BPS,
  INITIAL_CONFIG,
  LITURGY_GENRES,
  validateConfig,
  type LiturgyRules,
} from './index';

type Config = Record<string, unknown> & { liturgies: LiturgyRules };
const base = () => structuredClone(INITIAL_CONFIG) as Config;
const fieldsOf = (liturgies: unknown) => {
  const result = validateConfig({ ...base(), liturgies });
  return result.ok ? [] : [...new Set(result.errors.map((error) => error.split(':')[0]))];
};

describe('les liturgies (6.4, #719)', () => {
  it('la configuration initiale désigne dix maisons par cité, plancher, part, gains et perte du calibrage (#721)', () => {
    const result = validateConfig(INITIAL_CONFIG);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const liturgies = result.config.liturgies;
    expect(liturgies?.housesPerCity).toBe(10);
    expect([liturgies?.wealthFloor, liturgies?.dueShareBps]).toEqual([20_000, 4_500]);
    expect([liturgies?.honorGain, liturgies?.charisGain, liturgies?.evasionHonorLoss]).toEqual([
      100, 300, 300,
    ]);
    expect(liturgies?.genres).toEqual([...LITURGY_GENRES]);
  });

  it('une version publiée avant les liturgies reste lisible, sans liturgie', () => {
    const older: Record<string, unknown> = base();
    delete older['liturgies'];
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.liturgies).toBeUndefined();
  });

  it('entiers bornés ; dû minimal au plus le maximal et au plus le plancher ; genres connus, une fois chacun', () => {
    const liturgies = base().liturgies;
    expect(fieldsOf(liturgies)).toEqual([]);
    for (const [patch, field] of [
      [{ housesPerCity: -1 }, 'liturgies.housesPerCity'],
      [{ housesPerCity: 101 }, 'liturgies.housesPerCity'],
      [{ housesPerCity: 1.5 }, 'liturgies.housesPerCity'],
      [{ wealthFloor: -1 }, 'liturgies.wealthFloor'],
      [{ wealthFloor: Number.MAX_SAFE_INTEGER + 1 }, 'liturgies.wealthFloor'],
      [{ dueShareBps: 0 }, 'liturgies.dueShareBps'],
      [{ dueShareBps: 10_001 }, 'liturgies.dueShareBps'],
      [{ minDue: 0 }, 'liturgies.minDue'],
      [{ minDue: 0.5 }, 'liturgies.minDue'],
      [{ maxDue: 5_999 }, 'liturgies.maxDue'],
      [{ wealthFloor: 5_999 }, 'liturgies.wealthFloor'],
      [{ dueDays: 0 }, 'liturgies.dueDays'],
      [{ dueDays: 367 }, 'liturgies.dueDays'],
      [{ genres: [] }, 'liturgies.genres'],
      [{ genres: ['festival', 'festival'] }, 'liturgies.genres'],
      [{ genres: ['banquet'] }, 'liturgies.genres[0]'],
      [{ honorGain: -1 }, 'liturgies.honorGain'],
      [{ charisGain: 1_000_000_001 }, 'liturgies.charisGain'],
      [{ evasionHonorLoss: -5 }, 'liturgies.evasionHonorLoss'],
      [{ maxSplendorBps: -1 }, 'liturgies.maxSplendorBps'],
      [{ maxSplendorBps: 10_001 }, 'liturgies.maxSplendorBps'],
      [{ maxSplendorBps: 0.5 }, 'liturgies.maxSplendorBps'],
      [{ hidden: 1 }, 'liturgies'],
    ] as const)
      expect(fieldsOf({ ...liturgies, ...patch }), JSON.stringify(patch)).toEqual([field]);
    // Bornes atteintes : un seul dû possible, égal au plancher ; toute la fortune due.
    expect(
      fieldsOf({ ...liturgies, minDue: 7, maxDue: 7, wealthFloor: 7, dueShareBps: 10_000 }),
    ).toEqual([]);
  });

  it('le faste est borné à autant que le dû ; une version publiée avant #720 n’en admet aucun (#720)', () => {
    expect(base().liturgies.maxSplendorBps).toBe(10_000);
    const older: Partial<LiturgyRules> = base().liturgies;
    delete older.maxSplendorBps;
    const result = validateConfig({ ...base(), liturgies: older });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.liturgies?.maxSplendorBps).toBeUndefined();
    expect(DEFAULT_MAX_SPLENDOR_BPS).toBe(0);
    expect(fieldsOf({ ...base().liturgies, maxSplendorBps: 0 })).toEqual([]);
  });
});

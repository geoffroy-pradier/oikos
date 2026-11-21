import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, validateConfig, type HubrisRules } from './index';

type Config = Record<string, unknown> & { hubris: HubrisRules };
const base = () => structuredClone(INITIAL_CONFIG) as Config;
const fieldsOf = (hubris: unknown) => {
  const result = validateConfig({ ...base(), hubris });
  return result.ok ? [] : [...new Set(result.errors.map((error) => error.split(':')[0]))];
};

describe('l’Hybris (7.2, #734)', () => {
  it('la configuration initiale fixe seuils et paliers, avec des poids, des baisses et un déclin nuls', () => {
    const result = validateConfig(INITIAL_CONFIG);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const hubris = result.config.hubris;
    expect(hubris?.marketShareThresholdBps).toBe(3_500);
    expect(hubris?.marketShareWindowDays).toBeGreaterThan(0);
    expect(hubris?.wealthMultipleBps).toBeGreaterThan(10_000);
    expect([
      hubris?.marketShareWeight,
      hubris?.wealthWeight,
      hubris?.leviedLiturgyWeight,
      hubris?.offeringReliefBps,
      hubris?.performedLiturgyRelief,
      hubris?.dailyDecay,
    ]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(hubris?.tiers.length).toBeGreaterThan(0);
  });

  it('une version publiée avant l’Hybris reste lisible, sans Hybris', () => {
    const older: Record<string, unknown> = base();
    delete older['hubris'];
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.hubris).toBeUndefined();
  });

  it('valeurs entières et bornées, paliers strictement croissants ; aucun champ inconnu', () => {
    const hubris = base().hubris;
    expect(fieldsOf(hubris)).toEqual([]);
    for (const [patch, field] of [
      [{ marketShareThresholdBps: -1 }, 'hubris.marketShareThresholdBps'],
      [{ marketShareThresholdBps: 10_001 }, 'hubris.marketShareThresholdBps'],
      [{ marketShareThresholdBps: 35.5 }, 'hubris.marketShareThresholdBps'],
      [{ marketShareWindowDays: 0 }, 'hubris.marketShareWindowDays'],
      [{ marketShareWindowDays: 367 }, 'hubris.marketShareWindowDays'],
      [{ wealthMultipleBps: 9_999 }, 'hubris.wealthMultipleBps'],
      [{ marketShareWeight: -1 }, 'hubris.marketShareWeight'],
      [{ wealthWeight: 1_000_000_001 }, 'hubris.wealthWeight'],
      [{ leviedLiturgyWeight: 0.5 }, 'hubris.leviedLiturgyWeight'],
      [{ offeringReliefBps: -1 }, 'hubris.offeringReliefBps'],
      [{ performedLiturgyRelief: -1 }, 'hubris.performedLiturgyRelief'],
      [{ dailyDecay: -1 }, 'hubris.dailyDecay'],
      [{ tiers: [] }, 'hubris.tiers'],
      [{ tiers: [0, 10] }, 'hubris.tiers[0]'],
      [{ tiers: [10, 10] }, 'hubris.tiers'],
      [{ tiers: [20, 10] }, 'hubris.tiers'],
      [{ tiers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, 'hubris.tiers'],
      [{ hidden: 1 }, 'hubris'],
    ] as const)
      expect(fieldsOf({ ...hubris, ...patch })).toEqual([field]);
    expect(fieldsOf({ ...hubris, marketShareThresholdBps: 0, wealthMultipleBps: 10_000 })).toEqual(
      [],
    );
  });
});

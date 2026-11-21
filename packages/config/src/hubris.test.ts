import type { NemesisModelCode } from '@oikos/db';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  INITIAL_CONFIG,
  NEMESIS_MODELS,
  validateConfig,
  type HubrisRules,
  type NemesisModel,
} from './index';

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

describe('Némésis (7.2, #735)', () => {
  const nemesisOf = (patch: Record<string, unknown>) => {
    const hubris = base().hubris;
    return fieldsOf({ ...hubris, nemesis: { ...hubris.nemesis, ...patch } });
  };

  it('la configuration initiale fixe un seuil inaccessible : la jauge ne dépasse jamais le plus grand entier sûr', () => {
    const result = validateConfig(INITIAL_CONFIG);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const nemesis = result.config.hubris?.nemesis;
    expect(nemesis?.threshold).toBe(Number.MAX_SAFE_INTEGER);
    expect(nemesis?.omenLeadDays).toBeGreaterThan(0);
    expect(Object.keys(nemesis?.models ?? {}).sort()).toEqual([...NEMESIS_MODELS].sort());
    // Les modèles de la configuration sont ceux de la contrainte de la base.
    expectTypeOf<NemesisModel>().toEqualTypeOf<NemesisModelCode>();
  });

  it('une version publiée avant Némésis reste lisible, sans Némésis', () => {
    const older = base();
    delete older.hubris.nemesis;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.hubris?.nemesis).toBeUndefined();
  });

  it('valeurs entières et bornées, parts ordonnées, au moins un modèle ; aucun champ inconnu', () => {
    const fire = (share: unknown) => ({ models: { warehouse_fire: share } });
    expect(nemesisOf({})).toEqual([]);
    expect(nemesisOf({ threshold: 0, ...fire({ minBps: 0, maxBps: 10_000 }) })).toEqual([]);
    for (const [patch, field] of [
      [{ threshold: -1 }, 'hubris.nemesis.threshold'],
      [{ threshold: Number.MAX_SAFE_INTEGER + 1 }, 'hubris.nemesis.threshold'],
      [{ threshold: 1.5 }, 'hubris.nemesis.threshold'],
      [{ omenLeadDays: 0 }, 'hubris.nemesis.omenLeadDays'],
      [{ omenLeadDays: 31 }, 'hubris.nemesis.omenLeadDays'],
      [{ fullExcess: 0 }, 'hubris.nemesis.fullExcess'],
      [fire({ minBps: -1, maxBps: 10 }), 'hubris.nemesis.models.warehouse_fire.minBps'],
      [fire({ minBps: 0, maxBps: 0 }), 'hubris.nemesis.models.warehouse_fire.maxBps'],
      [fire({ minBps: 0, maxBps: 10_001 }), 'hubris.nemesis.models.warehouse_fire.maxBps'],
      [fire({ minBps: 20, maxBps: 10 }), 'hubris.nemesis.models.warehouse_fire'],
      [fire({ minBps: 1, maxBps: 2, more: 3 }), 'hubris.nemesis.models.warehouse_fire'],
      [{ models: {} }, 'hubris.nemesis.models'],
      [{ models: { ship_lost: { bps: 1 } } }, 'hubris.nemesis.models.ship_lost'],
      [{ models: { plague: {} } }, 'hubris.nemesis.models'],
      [{ hidden: 1 }, 'hubris.nemesis'],
    ] as const)
      expect(nemesisOf(patch)).toEqual([field]);
  });
});

import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, validateConfig, type TempleTreasuryRules } from './index';

type Config = Record<string, unknown> & { templeTreasury: TempleTreasuryRules };
const base = () => structuredClone(INITIAL_CONFIG) as Config;
const fieldsOf = (templeTreasury: unknown) => {
  const result = validateConfig({ ...base(), templeTreasury });
  return result.ok ? [] : [...new Set(result.errors.map((error) => error.split(':')[0]))];
};

describe('le Trésor du temple (5.4, #724)', () => {
  it('la configuration initiale ne prête rien : plafonds nuls à tout palier', () => {
    const result = validateConfig(INITIAL_CONFIG);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const rules = result.config.templeTreasury;
    expect(rules?.principalCaps.length).toBeGreaterThan(0);
    expect(rules?.principalCaps.map((tier) => tier.maxPrincipal)).toEqual(
      rules?.principalCaps.map(() => 0),
    );
    expect(rules?.termDays.length).toBeGreaterThan(0);
  });

  it('une version publiée avant le Trésor du temple reste lisible, sans prêt', () => {
    const older: Record<string, unknown> = base();
    delete older['templeTreasury'];
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.templeTreasury).toBeUndefined();
  });

  it('taux, durées et paliers entiers et bornés ; paliers croissants qui ne prêtent pas moins', () => {
    const rules = base().templeTreasury;
    expect(fieldsOf(rules)).toEqual([]);
    const tiers = (...rows: [number, number][]) =>
      rows.map(([minHonor, maxPrincipal]) => ({ minHonor, maxPrincipal }));
    for (const [patch, field] of [
      [{ policyRateBps: -1 }, 'templeTreasury.policyRateBps'],
      [{ policyRateBps: 10_001 }, 'templeTreasury.policyRateBps'],
      [{ policyRateBps: 2.5 }, 'templeTreasury.policyRateBps'],
      [{ termDays: [] }, 'templeTreasury.termDays'],
      [{ termDays: [0] }, 'templeTreasury.termDays[0]'],
      [{ termDays: [367] }, 'templeTreasury.termDays[0]'],
      [{ termDays: [7, 7] }, 'templeTreasury.termDays'],
      [{ principalCaps: tiers([0, -1]) }, 'templeTreasury.principalCaps[0].maxPrincipal'],
      [{ principalCaps: tiers([0, 1e12 + 1]) }, 'templeTreasury.principalCaps[0].maxPrincipal'],
      [{ principalCaps: tiers([0.5, 1]) }, 'templeTreasury.principalCaps[0].minHonor'],
      [{ principalCaps: tiers([0, 10], [0, 20]) }, 'templeTreasury.principalCaps[1].minHonor'],
      [{ principalCaps: tiers([5, 10], [0, 20]) }, 'templeTreasury.principalCaps[1].minHonor'],
      [{ principalCaps: tiers([0, 20], [5, 10]) }, 'templeTreasury.principalCaps[1].maxPrincipal'],
      [{ hidden: 1 }, 'templeTreasury'],
    ] as const)
      expect(fieldsOf({ ...rules, ...patch }), JSON.stringify(patch)).toEqual([field]);
    // Bornes atteintes : taux nul ou de 100 %, une seule durée d'un an, aucun palier, paliers égaux en plafond.
    for (const patch of [
      { policyRateBps: 0 },
      { policyRateBps: 10_000, termDays: [366] },
      { principalCaps: [] },
      { principalCaps: tiers([-1e9, 0], [0, 1e12], [1e9, 1e12]) },
    ])
      expect(fieldsOf({ ...rules, ...patch }), JSON.stringify(patch)).toEqual([]);
  });
});

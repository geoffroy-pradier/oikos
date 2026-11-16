import { GRACE_EFFECTS, GRACE_MAX_MAGNITUDE_BPS } from '@oikos/config';
import { fairWindSeconds, graceSurplus } from '@oikos/sim';
import { describe, expect, it } from 'vitest';

// Les bornes d'ampleur des grâces vivent dans `packages/config` (validation) et dans `packages/sim` (calcul), qui ne
// dépendent pas l'un de l'autre : une version admise par la configuration doit toujours se calculer (#266).
describe('bornes des grâces : configuration et simulation concordent', () => {
  const compute = (effect: (typeof GRACE_EFFECTS)[number], magnitudeBps: number) =>
    effect === 'fair_wind'
      ? fairWindSeconds(3_600, magnitudeBps)
      : graceSurplus([{ goodId: 'wheat', quantity: 40 }], magnitudeBps);

  it('chaque effet se calcule à sa borne, et pas au-delà', () => {
    for (const effect of GRACE_EFFECTS) {
      const max = GRACE_MAX_MAGNITUDE_BPS[effect];
      expect(() => compute(effect, max)).not.toThrow();
      expect(() => compute(effect, max + 1)).toThrow(RangeError);
    }
    expect(GRACE_MAX_MAGNITUDE_BPS.fair_wind).toBe(5_000);
  });
});

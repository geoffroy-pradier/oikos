import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, validateConfig, type BankRules } from './index';

const base = () => structuredClone(INITIAL_CONFIG) as Record<string, unknown>;
const RULES: BankRules = {
  charterFeeOboles: 5_000,
  minCapitalOboles: 20_000,
  reserveRatioBps: 2_000,
  depositRateBps: { min: 0, max: 1_500 },
  loanRateBps: { min: 300, max: 5_000 },
};
const fieldsOf = (banks: unknown) => {
  const result = validateConfig({ ...base(), banks });
  return result.ok ? [] : [...new Set(result.errors.map((error) => error.split(':')[0]))];
};

describe('les banques de joueurs (5.4, #726)', () => {
  it('la configuration initiale ne porte pas de section : aucune banque ne se fonde', () => {
    const result = validateConfig(INITIAL_CONFIG);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.banks).toBeUndefined();
    expect(Object.hasOwn(base(), 'banks')).toBe(false);
  });

  it('droit, capital, réserve et bornes des taux entiers et bornés', () => {
    expect(fieldsOf(RULES)).toEqual([]);
    const result = validateConfig({ ...base(), banks: RULES });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.banks).toEqual(RULES);
    for (const [patch, field] of [
      [{ charterFeeOboles: -1 }, 'banks.charterFeeOboles'],
      [{ charterFeeOboles: 1.5 }, 'banks.charterFeeOboles'],
      [{ charterFeeOboles: 1e12 + 1 }, 'banks.charterFeeOboles'],
      [{ minCapitalOboles: -1 }, 'banks.minCapitalOboles'],
      [{ minCapitalOboles: 1e12 + 1 }, 'banks.minCapitalOboles'],
      [{ reserveRatioBps: -1 }, 'banks.reserveRatioBps'],
      [{ reserveRatioBps: 10_001 }, 'banks.reserveRatioBps'],
      [{ reserveRatioBps: 0.5 }, 'banks.reserveRatioBps'],
      [{ depositRateBps: { min: -1, max: 10 } }, 'banks.depositRateBps.min'],
      [{ depositRateBps: { min: 0, max: 100_001 } }, 'banks.depositRateBps.max'],
      [{ depositRateBps: { min: 11, max: 10 } }, 'banks.depositRateBps.max'],
      [{ loanRateBps: { min: 0, max: 1.5 } }, 'banks.loanRateBps.max'],
      [{ loanRateBps: { min: 5_001, max: 5_000 } }, 'banks.loanRateBps.max'],
      [{ loanRateBps: { min: 0 } }, 'banks.loanRateBps.max'],
      [{ loanRateBps: { min: 0, max: 1, step: 1 } }, 'banks.loanRateBps'],
      [{ perHouse: 2 }, 'banks'],
    ] as const)
      expect(fieldsOf({ ...RULES, ...patch }), JSON.stringify(patch)).toEqual([field]);
    // Bornes atteintes : droit et capital nuls, réserve totale, taux égaux, taux au plafond technique.
    for (const patch of [
      { charterFeeOboles: 0, minCapitalOboles: 0 },
      { charterFeeOboles: 1e12, minCapitalOboles: 1e12 },
      { reserveRatioBps: 0 },
      { reserveRatioBps: 10_000 },
      { depositRateBps: { min: 0, max: 0 }, loanRateBps: { min: 100_000, max: 100_000 } },
    ])
      expect(fieldsOf({ ...RULES, ...patch }), JSON.stringify(patch)).toEqual([]);
  });
});

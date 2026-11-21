import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bankRequiredReserve, bankWithdrawableCapital } from './bank';

const rules = (minCapitalOboles: number, reserveRatioBps: number) => ({
  minCapitalOboles,
  reserveRatioBps,
});

describe('réserve exigée d’une banque (#726)', () => {
  it('exemples : le capital minimal sans dépôt, la part des dépôts arrondie à l’obole supérieure au-delà', () => {
    expect(bankRequiredReserve(0n, rules(20_000, 2_000))).toBe(20_000n);
    expect(bankRequiredReserve(0n, rules(0, 2_000))).toBe(0n);
    // 20 % de 100 001 oboles : 20 000,2, arrondi à 20 001, au-dessus du capital minimal.
    expect(bankRequiredReserve(100_001n, rules(20_000, 2_000))).toBe(20_001n);
    expect(bankRequiredReserve(100_000n, rules(20_000, 2_000))).toBe(20_000n);
    // Une obole de dépôt au plus petit ratio : une obole de réserve, jamais zéro.
    expect(bankRequiredReserve(1n, rules(0, 1))).toBe(1n);
    expect(bankRequiredReserve(1_000n, rules(0, 0))).toBe(0n);
    // Ratio total : tous les dépôts.
    expect(bankRequiredReserve(12_345n, rules(0, 10_000))).toBe(12_345n);
  });

  it('refuse des dépôts négatifs ou des règles hors des entiers admis', () => {
    expect(() => bankRequiredReserve(-1n, rules(0, 0))).toThrow(RangeError);
    expect(() => bankRequiredReserve(0n, rules(-1, 0))).toThrow(RangeError);
    expect(() => bankRequiredReserve(0n, rules(0.5, 0))).toThrow(RangeError);
    expect(() => bankRequiredReserve(0n, rules(0, 10_001))).toThrow(RangeError);
    expect(() => bankRequiredReserve(0n, rules(0, -1))).toThrow(RangeError);
  });

  it('propriété : le plus petit montant qui couvre à la fois le capital minimal et la part des dépôts, croissant', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.integer({ min: 0, max: 1e12 }),
        fc.integer({ min: 0, max: 10_000 }),
        (deposits, min, ratio) => {
          const reserve = bankRequiredReserve(deposits, rules(min, ratio));
          const product = deposits * BigInt(ratio);
          expect(reserve >= BigInt(min)).toBe(true);
          expect(reserve * 10_000n >= product).toBe(true);
          // Minimal : une obole de moins manque au plancher ou à la part des dépôts.
          expect(reserve - 1n < BigInt(min) || (reserve - 1n) * 10_000n < product).toBe(true);
          expect(bankRequiredReserve(deposits + 1n, rules(min, ratio)) >= reserve).toBe(true);
          if (ratio < 10_000)
            expect(bankRequiredReserve(deposits, rules(min, ratio + 1)) >= reserve).toBe(true);
          if (ratio === 10_000) expect(reserve >= deposits).toBe(true);
        },
      ),
    );
  });
});

describe('capital retirable d’un coffre (#726)', () => {
  it('exemples : l’excédent sur la réserve ; rien à la réserve, en dessous, ou d’un coffre vide', () => {
    expect(bankWithdrawableCapital(25_000n, 20_000n)).toBe(5_000n);
    expect(bankWithdrawableCapital(20_000n, 20_000n)).toBe(0n);
    expect(bankWithdrawableCapital(15_000n, 20_000n)).toBe(0n);
    expect(bankWithdrawableCapital(0n, 0n)).toBe(0n);
    expect(bankWithdrawableCapital(7n, 0n)).toBe(7n);
    expect(() => bankWithdrawableCapital(-1n, 0n)).toThrow(RangeError);
    expect(() => bankWithdrawableCapital(0n, -1n)).toThrow(RangeError);
  });

  it('propriété : un retrait du retirable laisse le coffre à la réserve au moins, et ne vide jamais en dessous', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        (vault, reserve) => {
          const free = bankWithdrawableCapital(vault, reserve);
          expect(free >= 0n && free <= vault).toBe(true);
          // Conservation : ce qui reste et ce qui sort font le coffre.
          const left = vault - free;
          expect(left + free).toBe(vault);
          expect(left >= reserve || free === 0n).toBe(true);
          // Une obole de plus passerait sous la réserve.
          if (vault > reserve) expect(left).toBe(reserve);
        },
      ),
    );
  });
});

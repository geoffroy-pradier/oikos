import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { levyLiturgies, liturgyGain, maxSplendor } from './liturgy-settlement';

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const due = fc.bigInt({ min: 1n, max: MAX });
const bps = fc.integer({ min: 0, max: 10_000 });

describe('faste d’une liturgie (#720)', () => {
  it('exemples : part du dû arrondie vers le bas, borne nulle, entiers sûrs', () => {
    expect(maxSplendor(1_000n, 10_000)).toBe(1_000n);
    expect(maxSplendor(1_000n, 2_500)).toBe(250n);
    expect(maxSplendor(999n, 2_500)).toBe(249n); // 249,75 → 249
    expect(maxSplendor(1n, 9_999)).toBe(0n);
    expect(maxSplendor(1_000n, 0)).toBe(0n);
    expect(maxSplendor(MAX, 10_000)).toBe(0n);
    expect(maxSplendor(MAX - 10n, 10_000)).toBe(10n);
    expect(() => maxSplendor(0n, 10_000)).toThrow(RangeError);
    expect(() => maxSplendor(1n, -1)).toThrow(RangeError);
  });

  it('propriété : au plus la part du dû, et dû plus faste reste un entier sûr', () => {
    fc.assert(
      fc.property(due, bps, (d, b) => {
        const bound = maxSplendor(d, b);
        expect(bound >= 0n).toBe(true);
        expect(bound * 10_000n <= d * BigInt(b)).toBe(true);
        expect(d + bound <= MAX).toBe(true);
        // La borne est la plus haute admise : une obole de plus la dépasse, sauf au plafond des entiers sûrs.
        if (d + bound < MAX) expect((bound + 1n) * 10_000n > d * BigInt(b)).toBe(true);
      }),
    );
  });
});

describe('gain d’une liturgie accomplie (#720)', () => {
  it('exemples : sans faste le gain, doublé par un faste égal au dû, arrondi vers le bas', () => {
    expect(liturgyGain(10, 1_000n, 0n)).toBe(10);
    expect(liturgyGain(10, 1_000n, 1_000n)).toBe(20);
    expect(liturgyGain(10, 1_000n, 99n)).toBe(10); // 10,99 → 10
    expect(liturgyGain(10, 1_000n, 100n)).toBe(11);
    expect(liturgyGain(0, 1_000n, 1_000n)).toBe(0);
    expect(liturgyGain(1_000_000_000, 1n, 1n)).toBe(2_000_000_000);
    expect(() => liturgyGain(-1, 1n, 0n)).toThrow(RangeError);
    expect(() => liturgyGain(1, 0n, 0n)).toThrow(RangeError);
    expect(() => liturgyGain(1, 1n, -1n)).toThrow(RangeError);
  });

  it('propriété : croissant avec le faste, entre le gain et le gain fois (1 + faste ÷ dû)', () => {
    const gain = fc.integer({ min: 0, max: 1_000_000_000 });
    fc.assert(
      fc.property(gain, due, bps, fc.double({ min: 0, max: 1, noNaN: true }), (g, d, b, at) => {
        const bound = maxSplendor(d, b);
        const s = (bound * BigInt(Math.floor(at * 1_000))) / 1_000n;
        const value = liturgyGain(g, d, s);
        expect(value >= g).toBe(true);
        expect(BigInt(value) * d <= BigInt(g) * (d + s)).toBe(true);
        expect(liturgyGain(g, d, bound) >= value).toBe(true);
        expect(liturgyGain(g, d, 0n)).toBe(g);
      }),
    );
  });
});

describe('prélèvement d’office (#720)', () => {
  it('exemples : en entier, en partie, rien sur une trésorerie vide ou absente', () => {
    const treasuries = new Map([
      ['a', 1_000n],
      ['b', 300n],
      ['c', 0n],
      ['d', -5n],
    ]);
    const levied = levyLiturgies(treasuries, [
      { houseId: 'a', due: 600n },
      { houseId: 'a', due: 600n },
      { houseId: 'b', due: 500n },
      { houseId: 'c', due: 1n },
      { houseId: 'd', due: 1n },
      { houseId: 'e', due: 1n },
      { houseId: 'a', due: 1n },
    ]);
    expect(levied.map((row) => row.levied)).toEqual([600n, 400n, 300n, 0n, 0n, 0n, 0n]);
    expect(() => levyLiturgies(treasuries, [{ houseId: 'a', due: 0n }])).toThrow(RangeError);
  });

  it('propriété : conservation, chaque prélèvement borné par son dû, entier tant que la trésorerie le couvre', () => {
    const house = fc.constantFrom('a', 'b', 'c');
    const liturgy = fc.record({ houseId: house, due: fc.bigInt({ min: 1n, max: 10_000n }) });
    const treasury = fc.bigInt({ min: -100n, max: 30_000n });
    fc.assert(
      fc.property(
        fc.record({ a: treasury, b: treasury, c: treasury }),
        fc.array(liturgy, { maxLength: 12 }),
        (start, liturgies) => {
          const treasuries = new Map(Object.entries(start));
          const levied = levyLiturgies(treasuries, liturgies);
          expect(levied.map(({ levied: _levied, ...rest }) => rest)).toEqual(liturgies);
          const left = new Map(
            [...treasuries].map(([id, value]) => [id, value > 0n ? value : 0n] as const),
          );
          for (const row of levied) {
            const before = left.get(row.houseId) ?? 0n;
            expect(row.levied >= 0n && row.levied <= row.due).toBe(true);
            // En entier, ou tout ce qui reste : jamais une partie quand la trésorerie couvrait le dû.
            expect(row.levied).toBe(before < row.due ? before : row.due);
            left.set(row.houseId, before - row.levied);
          }
          // La monnaie ne se crée ni ne se perd : prélevé plus reste égale la trésorerie de départ (positive).
          for (const [id, value] of treasuries) {
            const taken = levied
              .filter((row) => row.houseId === id)
              .reduce((sum, row) => sum + row.levied, 0n);
            expect(taken + (left.get(id) ?? 0n)).toBe(value > 0n ? value : 0n);
            expect((left.get(id) ?? 0n) >= 0n).toBe(true);
          }
        },
      ),
    );
  });
});

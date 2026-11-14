import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { priceCandles, type TradePrint } from './candles';

const HOUR = 3_600_000;
/** 14 novembre 2026, 10 h en temps universel : un début d'heure. */
const T = Date.UTC(2026, 10, 14, 10);
const trade = (at: number, price: number, quantity: number): TradePrint => ({
  at,
  price,
  quantity,
});
const TRADES = [
  trade(T, 6, 10),
  trade(T + 1000, 8, 5),
  trade(T + HOUR - 1, 5, 20),
  trade(T + HOUR, 7, 1),
  trade(T + 2.5 * HOUR, 9, 2),
  trade(T + HOUR + 1, 4, 3),
];

describe('chandeliers de prix', () => {
  it('exemple : une heure se ferme à la dernière milliseconde, une heure vide n’a pas de chandelier', () => {
    expect(priceCandles(TRADES, 3600)).toEqual([
      // 6×10 + 8×5 + 5×20 = 200
      { periodStart: T, open: 6, high: 8, low: 5, close: 5, volume: 35, turnover: 200 },
      // 7×1 + 4×3 = 19 ; l'échange à 4 est reçu après celui de 12 h 30, il clôt quand même 11 h
      { periodStart: T + HOUR, open: 7, high: 7, low: 4, close: 4, volume: 4, turnover: 19 },
      { periodStart: T + 2 * HOUR, open: 9, high: 9, low: 9, close: 9, volume: 2, turnover: 18 },
    ]);
    expect(priceCandles([], 3600)).toEqual([]);
  });

  it('exemple : la même liste en journées, alignées sur minuit en temps universel', () => {
    expect(priceCandles(TRADES, 86_400)).toEqual([
      {
        periodStart: Date.UTC(2026, 10, 14),
        open: 6,
        high: 9,
        low: 4,
        close: 4,
        volume: 41,
        turnover: 237,
      },
    ]);
    // Avant l'époque Unix, la période se compte vers le bas, pas vers zéro.
    expect(priceCandles([trade(-1, 3, 1)], 60)[0]?.periodStart).toBe(-60_000);
  });

  it('refuse une durée, un prix ou une quantité qui ne sont pas des entiers positifs, et un montant hors des entiers sûrs', () => {
    for (const period of [0, -3600, 1.5, Number.NaN, 2_147_483_648])
      expect(() => priceCandles(TRADES, period)).toThrow(RangeError);
    for (const bad of [trade(T, 0, 1), trade(T, 1.5, 1), trade(T, 1, 0), trade(T + 0.5, 1, 1)])
      expect(() => priceCandles([bad], 3600)).toThrow(RangeError);
    expect(priceCandles(TRADES, 2_147_483_647)).toHaveLength(1);
    const huge = trade(T, Number.MAX_SAFE_INTEGER, 1);
    expect(() => priceCandles([trade(T, Number.MAX_SAFE_INTEGER, 2)], 3600)).toThrow(RangeError);
    expect(() => priceCandles([huge, trade(T, 1, 1)], 3600)).toThrow(RangeError);
    expect(priceCandles([huge], 3600)[0]?.turnover).toBe(Number.MAX_SAFE_INTEGER);
  });

  const prints = fc.array(
    fc.record({
      at: fc.integer({ min: T - 5 * HOUR, max: T + 5 * HOUR }),
      price: fc.integer({ min: 1, max: 1_000_000 }),
      quantity: fc.integer({ min: 1, max: 1_000_000 }),
    }),
    { maxLength: 40 },
  );
  const period = fc.constantFrom(1, 60, 600, 3600, 86_400);
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  it('rien ne se perd, et chaque chandelier respecte les contraintes de la table', () => {
    fc.assert(
      fc.property(prints, period, (trades, seconds) => {
        const candles = priceCandles(trades, seconds);
        expect(sum(candles.map((c) => c.volume))).toBe(sum(trades.map((t) => t.quantity)));
        expect(sum(candles.map((c) => c.turnover))).toBe(
          sum(trades.map((t) => t.price * t.quantity)),
        );
        const starts = candles.map((c) => c.periodStart);
        expect(starts).toEqual([...new Set(starts)].sort((a, b) => a - b));
        for (const c of candles) {
          expect(c.periodStart % (seconds * 1000)).toBe(0);
          expect(c.low).toBeGreaterThan(0);
          expect(Math.min(c.open, c.close)).toBeGreaterThanOrEqual(c.low);
          expect(Math.max(c.open, c.close)).toBeLessThanOrEqual(c.high);
          expect(c.turnover).toBeGreaterThanOrEqual(c.low * c.volume);
          expect(c.turnover).toBeLessThanOrEqual(c.high * c.volume);
          // Chaque échange tombe dans la période de son chandelier, et seulement là.
          const inside = trades.filter(
            (t) => t.at >= c.periodStart && t.at < c.periodStart + seconds * 1000,
          );
          expect(c.volume).toBe(sum(inside.map((t) => t.quantity)));
          expect([c.open, c.close]).toEqual([inside[0]?.price, inside.at(-1)?.price]);
          expect([c.low, c.high]).toEqual([
            Math.min(...inside.map((t) => t.price)),
            Math.max(...inside.map((t) => t.price)),
          ]);
        }
      }),
    );
  });

  it('recalculer avec les échanges arrivés depuis prolonge chaque chandelier sans le dédoubler', () => {
    fc.assert(
      fc.property(prints, prints, period, (earlier, later, seconds) => {
        const before = new Map(priceCandles(earlier, seconds).map((c) => [c.periodStart, c]));
        const added = new Map(priceCandles(later, seconds).map((c) => [c.periodStart, c]));
        const merged = priceCandles([...earlier, ...later], seconds);
        expect(merged.length).toBe(new Set([...before.keys(), ...added.keys()]).size);
        for (const c of merged) {
          const [a, b] = [before.get(c.periodStart), added.get(c.periodStart)];
          expect(c.open).toBe((a ?? b)?.open);
          expect(c.close).toBe((b ?? a)?.close);
          expect(c.high).toBe(Math.max(a?.high ?? 0, b?.high ?? 0));
          expect(c.low).toBe(Math.min(a?.low ?? Infinity, b?.low ?? Infinity));
          expect(c.volume).toBe((a?.volume ?? 0) + (b?.volume ?? 0));
          expect(c.turnover).toBe((a?.turnover ?? 0) + (b?.turnover ?? 0));
        }
      }),
    );
  });
});

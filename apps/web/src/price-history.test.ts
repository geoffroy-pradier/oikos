import { describe, expect, it } from 'vitest';
import {
  candleMarks,
  dayAgoCutoff,
  observedAverage,
  parseCandleSeconds,
  parsePriceSeries,
  priceSummary,
  type Candle,
} from './price-history';

const HOUR = 3_600_000;
/** 14 novembre 2026, 10 h en temps universel. */
const T = Date.UTC(2026, 10, 14, 10);
const row = (start: string, ohlc: [number, number, number, number], seconds = 3600) => ({
  city_id: 'kalliste',
  period_start: start,
  period_seconds: seconds,
  open: ohlc[0],
  high: ohlc[1],
  low: ohlc[2],
  close: ohlc[3],
  volume: 5,
  turnover: 30,
});
const candle = (hoursBefore: number, ohlc: [number, number, number, number]): Candle => ({
  periodStart: T - hoursBefore * HOUR,
  periodSeconds: 3600,
  open: ohlc[0],
  high: ohlc[1],
  low: ohlc[2],
  close: ohlc[3],
  volume: 5,
});

describe('série de chandeliers lue par le client', () => {
  it('rend la série de la durée en vigueur, du plus ancien au plus récent', () => {
    const rows = [
      row('2026-11-14T10:00:00+00:00', [7, 9, 7, 8]),
      row('2026-11-14T08:00:00+00:00', [6, 8, 5, 7]),
    ];
    expect(parsePriceSeries(rows, 3600)).toEqual([
      candle(2, [6, 8, 5, 7]),
      candle(0, [7, 9, 7, 8]),
    ]);
    expect(parsePriceSeries(rows, 900)).toEqual([]);
    expect(parsePriceSeries([], 3600)).toEqual([]);
  });

  it('après un changement de durée, les deux séries se recouvrent : seule celle en vigueur est rendue', () => {
    // Heure → journée à 9 h 30 : la journée en cours, reconstruite, commence avant les dernières heures.
    const day = row('2026-11-14T00:00:00+00:00', [6, 9, 5, 9], 86_400);
    const hours = [
      row('2026-11-14T08:00:00+00:00', [6, 8, 5, 7]),
      row('2026-11-14T09:00:00+00:00', [7, 7, 6, 6]),
    ];
    expect(parsePriceSeries([...hours, day], 86_400)).toEqual([
      { ...candle(10, [6, 9, 5, 9]), periodSeconds: 86_400 },
    ]);
    // Heure → quart d'heure à 10 h 05 : deux chandeliers commencent à 10 h, quel que soit l'ordre des lignes.
    const hour = row('2026-11-14T10:00:00+00:00', [7, 9, 7, 8]);
    const quarter = row('2026-11-14T10:00:00+00:00', [9, 9, 8, 8], 900);
    for (const rows of [
      [hour, quarter],
      [quarter, hour],
    ])
      expect(parsePriceSeries(rows, 900)).toEqual([
        { ...candle(0, [9, 9, 8, 8]), periodSeconds: 900 },
      ]);
  });

  it('durée en vigueur lue dans les règles de marché ; version antérieure : une heure ; illisible : inconnue', () => {
    expect(
      parseCandleSeconds({
        market_tax: null,
        price_history: { candleMinutes: 15, referenceWindowHours: 48 },
      }),
    ).toBe(900);
    expect(parseCandleSeconds({ price_history: null })).toBe(3600);
    for (const raw of [
      null,
      {},
      { price_history: {} },
      { price_history: { candleMinutes: 0 } },
      { price_history: { candleMinutes: '15' } },
    ])
      expect(parseCandleSeconds(raw)).toBeNull();
  });

  it.each([
    null,
    [row('14/11/2026 10:00', [6, 8, 5, 7])],
    [row('2026-11-14T10:00:00+00:00', [6, 8, 5, 7], 0)],
    [row('2026-11-14T10:00:00+00:00', [4, 8, 5, 7])], // ouverture sous le plus bas
    [row('2026-11-14T10:00:00+00:00', [6, 8, 5, 9])], // clôture au-dessus du plus haut
    [row('2026-11-14T10:00:00+00:00', [6, 8, 0, 7])],
    [{ ...row('2026-11-14T10:00:00+00:00', [6, 8, 5, 7]), volume: '5' }],
    [row('2026-11-14T10:00:00+00:00', [6, 8, 5, 7]), {}],
  ])('lecture illisible (%j) : inconnue, jamais prise pour une absence d’échange', (raw) => {
    expect(parsePriceSeries(raw, 3600)).toBeNull();
  });
});

describe('dernier prix et variation sur 24 heures', () => {
  const now = T + 30 * 60_000; // 10 h 30

  it('compare la dernière clôture à celle du dernier chandelier clos 24 heures plus tôt', () => {
    // À 10 h 30, le chandelier de 9 h la veille (clos à 10 h) convient ; celui de 10 h (clos à 11 h) non.
    expect(dayAgoCutoff(3600, now)).toBe(T - 25 * HOUR + 30 * 60_000);
    const series = [
      candle(30, [4, 4, 4, 4]),
      candle(25, [5, 8, 5, 8]),
      candle(24, [8, 20, 8, 20]),
      candle(0, [9, 10, 9, 10]),
    ];
    expect(priceSummary(series, now)).toEqual({ last: 10, lastAt: T, change: 0.25 }); // (10 − 8) ÷ 8
    expect(priceSummary([candle(25, [5, 8, 5, 8]), candle(1, [8, 8, 6, 6])], now)?.change).toBe(
      -0.25,
    );
  });

  it('variation arrondie au millième, sans zéro négatif', () => {
    // (2 999 − 3 000) ÷ 3 000 = −0,033 % : nulle à l'affichage, et pas « −0 ».
    const tiny = priceSummary(
      [candle(25, [3000, 3000, 3000, 3000]), candle(0, [2999, 2999, 2999, 2999])],
      now,
    );
    expect(Object.is(tiny?.change, 0)).toBe(true);
    // (7 − 6) ÷ 6 = 16,67 %.
    expect(priceSummary([candle(25, [6, 6, 6, 6]), candle(0, [7, 7, 7, 7])], now)?.change).toBe(
      0.167,
    );
  });

  it('rien échangé depuis plus de 24 heures : variation nulle ; historique trop court : inconnue ; aucun : rien', () => {
    expect(priceSummary([candle(72, [5, 5, 5, 5]), candle(48, [6, 7, 6, 7])], now)).toEqual({
      last: 7,
      lastAt: T - 48 * HOUR,
      change: 0,
    });
    expect(
      priceSummary([candle(24, [8, 9, 8, 9]), candle(0, [9, 10, 9, 10])], now)?.change,
    ).toBeNull();
    expect(priceSummary([], now)).toBeNull();
  });
});

describe('tracé des chandeliers', () => {
  it('un créneau par chandelier, échelle logarithmique du plus bas au plus haut, origine en haut', () => {
    // Prix de 2 à 16 sur 90 unités de haut : trois doublements, 30 unités chacun (16 → 0, 8 → 30, 4 → 60, 2 → 90).
    const { marks, slot, low, high } = candleMarks(
      [candle(2, [4, 16, 2, 8]), candle(1, [8, 8, 4, 4]), candle(0, [4, 8, 4, 4])],
      300,
      90,
    );
    expect([slot, low, high]).toEqual([100, 2, 16]);
    expect(marks).toEqual([
      { x: 50, wickTop: 0, wickBottom: 90, bodyTop: 30, bodyHeight: 30, trend: 'up' },
      { x: 150, wickTop: 30, wickBottom: 60, bodyTop: 30, bodyHeight: 30, trend: 'down' },
      // Ouverture = clôture : corps d'une unité, centré sur le prix (4, soit 60).
      { x: 250, wickTop: 30, wickBottom: 60, bodyTop: 59.5, bodyHeight: 1, trend: 'flat' },
    ]);
    // Un prix aberrant ne tasse pas les autres : de 2 à 4 096, passer de 2 à 4 occupe encore un onzième du cadre.
    const spike = candleMarks(
      [candle(1, [2, 4, 2, 4]), candle(0, [4, 4096, 4, 4])],
      100,
      110,
    ).marks;
    expect([spike[0]?.bodyTop, spike[0]?.bodyHeight]).toEqual([100, 10]);
  });

  it('prix tous égaux : tracés à mi-hauteur ; corps minimal au bord : gardé dans le cadre ; série vide : rien', () => {
    expect(candleMarks([candle(0, [7, 7, 7, 7])], 100, 80).marks).toEqual([
      { x: 50, wickTop: 40, wickBottom: 40, bodyTop: 39.5, bodyHeight: 1, trend: 'flat' },
    ]);
    const edges = candleMarks(
      [candle(1, [12, 12, 12, 12]), candle(0, [4, 4, 4, 4])],
      100,
      80,
    ).marks;
    expect(edges.map((mark) => mark.bodyTop)).toEqual([0, 79]);
    expect(candleMarks([], 100, 80)).toEqual({ marks: [], slot: 100, low: 0, high: 0 });
  });
});

describe('prix moyen observé annoncé par l’écran', () => {
  const row = {
    price: 8,
    volume: 20,
    window_seconds: 86_400,
    observed_at: '2026-11-14T10:00:00+00:00',
  };
  const read = { price: 8, volume: 20, hours: 24, observedAt: T };

  it('calcul de moins d’une fenêtre : prix « sur 24 heures » ; plus ancien : prix passé, à dater', () => {
    expect(observedAverage(row, T + 10 * 60_000)).toEqual({ ...read, current: true });
    // Plus aucun échange depuis : la ligne reste. À 24 heures pile elle vaut encore, une seconde après non.
    expect(observedAverage(row, T + 24 * HOUR)).toEqual({ ...read, current: true });
    expect(observedAverage(row, T + 24 * HOUR + 1000)).toEqual({ ...read, current: false });
    expect(observedAverage({ ...row, window_seconds: 3600 }, T + 2 * HOUR)).toEqual({
      ...read,
      hours: 1,
      current: false,
    });
    // Calcul daté après l'instant de lecture (horloge du navigateur en retard) : tenu pour courant.
    expect(observedAverage(row, T - HOUR)).toEqual({ ...read, current: true });
  });

  it.each([
    null,
    {},
    { ...row, price: 0 },
    { ...row, volume: '20' },
    { ...row, observed_at: 'hier' },
  ])('ligne illisible (%j) : inconnue', (raw) => expect(observedAverage(raw, T)).toBeNull());
});

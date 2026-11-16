import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addBoosts,
  caravanDemandBoosts,
  cycleYield,
  stormDurationSeconds,
  strongestAt,
  yieldDeltaBps,
  yieldModelOf,
} from './world-event-effects';

const T0 = new Date('2026-11-20T03:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const effect = (eventId: string, from: number, to: number, deltaBps: number) => ({
  eventId,
  startsAt: at(from),
  endsAt: at(to),
  deltaBps,
});

describe('rendement des cycles sous un événement', () => {
  it('catalogue : la sécheresse réduit les champs, la bonne année accroît les vergers', () => {
    expect([yieldModelOf('field'), yieldModelOf('orchard'), yieldModelOf('workshop')]).toEqual([
      'drought',
      'good_year',
      undefined,
    ]);
    expect([yieldDeltaBps('drought', 3_000), yieldDeltaBps('good_year', 3_000)]).toEqual([
      -3_000, 3_000,
    ]);
    expect([yieldDeltaBps('storm', 3_000), yieldDeltaBps('caravan', 3_000)]).toEqual([0, 0]);
  });

  it('seuls les cycles terminés pendant l’événement : début compris, fin exclue, arrondi vers le bas', () => {
    // Cycles de 60 minutes terminés à 60, 120, 180, 240 ; sécheresse de 30 % de 120 à 240.
    const yieldOf = (effects: ReturnType<typeof effect>[]) =>
      cycleYield({ since: T0, cycleMinutes: 60, cycles: 4, outputPerCycle: 25, effects });
    expect(yieldOf([])).toEqual({ quantity: 100, byEvent: new Map() });
    expect(yieldOf([effect('d', 120, 240, -3_000)])).toEqual({
      quantity: 25 + 17 + 17 + 25,
      byEvent: new Map([['d', -16]]),
    });
    // Rendement nul au plus fort, doublé au plus fort.
    expect(yieldOf([effect('d', 0, 1_000, -10_000)]).quantity).toBe(0);
    expect(yieldOf([effect('g', 0, 1_000, 10_000)]).quantity).toBe(200);
  });

  it('événements qui se chevauchent : le plus fort s’applique seul, à égalité le plus petit identifiant', () => {
    const effects = [effect('b', 0, 150, -2_000), effect('a', 100, 300, -4_000)];
    const result = cycleYield({
      since: T0,
      cycleMinutes: 60,
      cycles: 4,
      outputPerCycle: 10,
      effects,
    });
    expect(result).toEqual({
      quantity: 8 + 6 + 6 + 6,
      byEvent: new Map([
        ['b', -2],
        ['a', -12],
      ]),
    });
    const tie = [effect('z', 0, 100, -2_000), effect('y', 0, 100, -2_000)];
    expect(strongestAt(tie, at(60))?.eventId).toBe('y');
    expect(strongestAt(tie, at(100))).toBeUndefined();
  });

  it('propriétés : récolter en deux fois donne autant qu’en une ; écart borné, de signe de l’événement', () => {
    const anyEffect = fc
      .record({
        id: fc.constantFrom('a', 'b', 'c'),
        from: fc.integer({ min: 0, max: 3_000 }),
        length: fc.integer({ min: 1, max: 3_000 }),
        magnitude: fc.integer({ min: 0, max: 10_000 }),
      })
      .map(({ id, from, length, magnitude }) => ({ id, from, length, magnitude }));
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 600 }),
        fc.integer({ min: 0, max: 80 }),
        fc.integer({ min: 0, max: 80 }),
        fc.integer({ min: 1, max: 1_000 }),
        fc.array(anyEffect, { maxLength: 4 }),
        fc.constantFrom(-1, 1),
        (cycleMinutes, first, second, outputPerCycle, raw, sign) => {
          const effects = raw.map(({ id, from, length, magnitude }) =>
            effect(id, from, from + length, sign * magnitude),
          );
          const whole = cycleYield({
            since: T0,
            cycleMinutes,
            cycles: first + second,
            outputPerCycle,
            effects,
          });
          const head = cycleYield({
            since: T0,
            cycleMinutes,
            cycles: first,
            outputPerCycle,
            effects,
          });
          const tail = cycleYield({
            since: at(first * cycleMinutes),
            cycleMinutes,
            cycles: second,
            outputPerCycle,
            effects,
          });
          expect(head.quantity + tail.quantity).toBe(whole.quantity);
          const base = (first + second) * outputPerCycle;
          const gaps = [...whole.byEvent.values()].reduce((sum, gap) => sum + gap, 0);
          expect(whole.quantity - base).toBe(gaps);
          expect(whole.quantity).toBeGreaterThanOrEqual(0);
          expect(whole.quantity).toBeLessThanOrEqual(2 * base);
          if (sign < 0) expect(whole.quantity).toBeLessThanOrEqual(base);
          else expect(whole.quantity).toBeGreaterThanOrEqual(base);
        },
      ),
    );
  });

  it('refuse une variation hors bornes ou un rendement hors des entiers sûrs', () => {
    const base = { since: T0, cycleMinutes: 60, cycles: 1, outputPerCycle: 1 };
    expect(() => cycleYield({ ...base, effects: [effect('d', 0, 60, -10_001)] })).toThrow(
      RangeError,
    );
    expect(() => cycleYield({ ...base, outputPerCycle: 2 ** 52, effects: [] })).toThrow(RangeError);
  });
});

describe('tempête et caravane', () => {
  it('une tempête allonge le trajet, arrondi à la seconde supérieure, jamais plus du double', () => {
    expect(stormDurationSeconds(14_400, 0)).toBe(14_400);
    expect(stormDurationSeconds(14_400, 2_500)).toBe(18_000);
    expect(stormDurationSeconds(3, 3_333)).toBe(4);
    expect(stormDurationSeconds(14_400, 10_000)).toBe(28_800);
    expect(() => stormDurationSeconds(1, 10_001)).toThrow(RangeError);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (seconds, magnitude) => {
          const longer = stormDurationSeconds(seconds, magnitude);
          expect(longer).toBeGreaterThanOrEqual(seconds);
          expect(longer).toBeLessThanOrEqual(2 * seconds);
          expect(longer * 10_000).toBeGreaterThanOrEqual(seconds * (10_000 + magnitude));
        },
      ),
    );
  });

  it('caravanes : la plus forte d’un bien pendant ses jours, ajoutée à la hausse des fêtes', () => {
    const caravans = [
      { goodId: 'wine', startDay: 10, endDay: 12, magnitudeBps: 2_000 },
      { goodId: 'wine', startDay: 11, endDay: 13, magnitudeBps: 3_000 },
      { goodId: 'cloth', startDay: 12, endDay: 13, magnitudeBps: 1_000 },
      { goodId: null, startDay: 0, endDay: 99, magnitudeBps: 9_999 },
    ];
    expect(Object.fromEntries(caravanDemandBoosts(caravans, 9))).toEqual({});
    expect(Object.fromEntries(caravanDemandBoosts(caravans, 10))).toEqual({ wine: 2_000 });
    expect(Object.fromEntries(caravanDemandBoosts(caravans, 11))).toEqual({ wine: 3_000 });
    expect(Object.fromEntries(caravanDemandBoosts(caravans, 12))).toEqual({
      wine: 3_000,
      cloth: 1_000,
    });
    expect(Object.fromEntries(caravanDemandBoosts(caravans, 13))).toEqual({});
    const festival = new Map([
      ['wine', 2_500],
      ['bread', 500],
    ]);
    expect(Object.fromEntries(addBoosts(festival, caravanDemandBoosts(caravans, 12)))).toEqual({
      wine: 5_500,
      bread: 500,
      cloth: 1_000,
    });
  });

  it('propriétés : une caravane par bien, la plus forte, jamais cumulée ; somme des hausses commutative', () => {
    const caravan = fc.record({
      goodId: fc.constantFrom('wine', 'cloth', null),
      startDay: fc.integer({ min: 0, max: 20 }),
      days: fc.integer({ min: 1, max: 5 }),
      magnitudeBps: fc.integer({ min: 0, max: 10_000 }),
    });
    const boosts = fc
      .array(
        fc.tuple(
          fc.constantFrom<string>('wine', 'cloth', 'bread'),
          fc.integer({ min: 0, max: 10_000 }),
        ),
      )
      .map((entries) => new Map(entries));
    fc.assert(
      fc.property(
        fc.array(caravan, { maxLength: 6 }),
        fc.integer({ min: 0, max: 25 }),
        (raw, day) => {
          const caravans = raw.map(({ days, ...rest }) => ({
            ...rest,
            endDay: rest.startDay + days,
          }));
          for (const [goodId, boost] of caravanDemandBoosts(caravans, day)) {
            const active = caravans.filter(
              (row) => row.goodId === goodId && row.startDay <= day && day < row.endDay,
            );
            // Exactement l'ampleur de la plus forte en cours : jamais une somme, jamais au-delà de 10 000.
            expect(boost).toBe(Math.max(...active.map((row) => row.magnitudeBps)));
            expect(boost).toBeLessThanOrEqual(10_000);
          }
        },
      ),
    );
    fc.assert(
      fc.property(boosts, boosts, (a, b) => {
        const sum = addBoosts(a, b);
        expect(Object.fromEntries(sum)).toEqual(Object.fromEntries(addBoosts(b, a)));
        for (const [goodId, boost] of sum)
          expect(boost).toBe((a.get(goodId) ?? 0) + (b.get(goodId) ?? 0));
        expect(Object.fromEntries(addBoosts(a, new Map()))).toEqual(Object.fromEntries(a));
      }),
    );
  });
});

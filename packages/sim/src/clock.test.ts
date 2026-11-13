import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  isDailyClose,
  isSeasonSwitch,
  localTime,
  seasonIndexAt,
  tickIndexAt,
  tickStart,
  type ClockSettings,
} from './clock';

const PARIS: ClockSettings = {
  tickMinutes: 10,
  dailyCloseHour: 4,
  timezone: 'Europe/Paris',
  seasonDays: 7,
};
const at = (iso: string) => tickIndexAt(new Date(iso), PARIS.tickMinutes);
/** Ticks de clôture trouvés sur une plage, rendus en heure UTC. */
const closesBetween = (fromIso: string, toIso: string, clock = PARIS) => {
  const found: string[] = [];
  for (let index = at(fromIso); index < at(toIso); index++) {
    if (isDailyClose(index, clock)) found.push(tickStart(index, clock.tickMinutes).toISOString());
  }
  return found;
};

/** Nombre de clôtures entre deux ticks (borne basse comprise, borne haute exclue). */
const closesBetweenIndexes = (from: number, to: number) => {
  let count = 0;
  for (let index = from; index < to; index++) if (isDailyClose(index, PARIS)) count += 1;
  return count;
};

describe('ticks', () => {
  it('un instant appartient au tick qui commence à ou avant lui, et les ticks se suivent sans trou', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2040-01-01'), noInvalidDate: true }),
        (instant) => {
          const index = tickIndexAt(instant, 10);
          expect(tickStart(index, 10).getTime()).toBeLessThanOrEqual(instant.getTime());
          expect(tickStart(index + 1, 10).getTime()).toBeGreaterThan(instant.getTime());
          expect(tickStart(index + 1, 10).getTime() - tickStart(index, 10).getTime()).toBe(600_000);
        },
      ),
    );
  });

  it('144 ticks de 10 minutes par jour', () => {
    expect(at('2026-11-14T00:00:00Z') - at('2026-11-13T00:00:00Z')).toBe(144);
  });
});

describe('clôture quotidienne à 04 h 00, heure de Paris', () => {
  it('tombe à 03 h 00 UTC en hiver et à 02 h 00 UTC en été', () => {
    expect(closesBetween('2026-01-15T00:00:00Z', '2026-01-16T00:00:00Z')).toEqual([
      '2026-01-15T03:00:00.000Z',
    ]);
    expect(closesBetween('2026-07-15T00:00:00Z', '2026-07-16T00:00:00Z')).toEqual([
      '2026-07-15T02:00:00.000Z',
    ]);
  });

  it('exactement une clôture par jour, y compris les jours de changement d’heure', () => {
    // 29 mars 2026 : passage à l'heure d'été. 25 octobre 2026 : retour à l'heure d'hiver.
    expect(closesBetween('2026-03-28T12:00:00Z', '2026-03-30T12:00:00Z')).toEqual([
      '2026-03-29T02:00:00.000Z',
      '2026-03-30T02:00:00.000Z',
    ]);
    expect(closesBetween('2026-10-24T12:00:00Z', '2026-10-26T12:00:00Z')).toEqual([
      '2026-10-25T03:00:00.000Z',
      '2026-10-26T03:00:00.000Z',
    ]);
    expect(closesBetween('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')).toHaveLength(365);
  });

  it('lit l’heure locale avec l’heure d’été', () => {
    expect(localTime(new Date('2026-07-15T02:00:00Z'), 'Europe/Paris')).toMatchObject({
      hour: 4,
      minute: 0,
      day: 15,
      month: 7,
    });
    expect(localTime(new Date('2026-01-15T23:30:00Z'), 'Europe/Paris')).toMatchObject({
      hour: 0,
      minute: 30,
      day: 16,
    });
  });
});

describe('bascule de saison', () => {
  const switches = (fromIso: string, toIso: string) => {
    const found: string[] = [];
    for (let index = at(fromIso); index < at(toIso); index++) {
      if (isSeasonSwitch(index, PARIS)) found.push(tickStart(index, 10).toISOString());
    }
    return found;
  };

  it('a lieu le lundi, à la clôture, une fois par semaine', () => {
    // Novembre 2026 : les lundis sont les 2, 9, 16, 23 et 30.
    expect(switches('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z')).toEqual([
      '2026-11-02T03:00:00.000Z',
      '2026-11-09T03:00:00.000Z',
      '2026-11-16T03:00:00.000Z',
      '2026-11-23T03:00:00.000Z',
      '2026-11-30T03:00:00.000Z',
    ]);
  });

  it('la saison change à la clôture du lundi, pas à minuit', () => {
    const before = seasonIndexAt(at('2026-11-09T02:50:00Z'), PARIS);
    expect(seasonIndexAt(at('2026-11-08T23:30:00Z'), PARIS)).toBe(before);
    expect(seasonIndexAt(at('2026-11-09T03:00:00Z'), PARIS)).toBe(before + 1);
    expect(seasonIndexAt(at('2026-11-15T22:00:00Z'), PARIS)).toBe(before + 1);
  });

  it('suit la durée de saison de la configuration : avec 28 jours, une bascule toutes les 28 clôtures', () => {
    const clock = { ...PARIS, seasonDays: 28 };
    const found: number[] = [];
    for (let index = at('2026-01-01T00:00:00Z'); index < at('2027-01-01T00:00:00Z'); index++) {
      if (isSeasonSwitch(index, clock)) found.push(index);
    }
    expect(found).toHaveLength(13);
    const gaps = found
      .slice(1)
      .map((index, position) => closesBetweenIndexes(found[position] ?? 0, index));
    expect(new Set(gaps)).toEqual(new Set([28]));
  });

  it('avec une saison d’un jour, chaque clôture est une bascule', () => {
    const clock = { ...PARIS, seasonDays: 1 };
    const from = at('2026-11-01T00:00:00Z');
    for (let index = from; index < from + 144 * 3; index++) {
      expect(isSeasonSwitch(index, clock)).toBe(isDailyClose(index, clock));
    }
  });

  it('52 ou 53 bascules par an, jamais deux le même jour', () => {
    const year = switches('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z');
    expect(year).toHaveLength(52);
    expect(new Set(year.map((iso) => iso.slice(0, 10))).size).toBe(year.length);
  });
});

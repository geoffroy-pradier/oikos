import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  dailyCloseAt,
  gameDayAt,
  gameDayDate,
  isDailyClose,
  isSeasonSwitch,
  localTime,
  nextDailyClose,
  seasonIndexAt,
  tickIndexAt,
  tickStart,
  type ClockSettings,
  type DayClock,
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

describe('prochaine clôture quotidienne', () => {
  it('est la clôture du jour avant 04 h 00 locales, celle du lendemain ensuite', () => {
    // Hiver : 04 h 00 à Paris = 03 h 00 UTC.
    expect(nextDailyClose(new Date('2026-01-15T02:59:59Z'), PARIS).toISOString()).toBe(
      '2026-01-15T03:00:00.000Z',
    );
    expect(nextDailyClose(new Date('2026-01-15T12:00:00Z'), PARIS).toISOString()).toBe(
      '2026-01-16T03:00:00.000Z',
    );
  });

  it('est strictement après l’instant donné, même à la seconde de la clôture', () => {
    expect(nextDailyClose(new Date('2026-01-15T03:00:00Z'), PARIS).toISOString()).toBe(
      '2026-01-16T03:00:00.000Z',
    );
    expect(nextDailyClose(new Date('2026-01-15T03:04:00Z'), PARIS).toISOString()).toBe(
      '2026-01-16T03:00:00.000Z',
    );
  });

  it('suit le passage à l’heure d’été : 02 h 00 UTC le lendemain du changement', () => {
    expect(nextDailyClose(new Date('2026-03-28T12:00:00Z'), PARIS).toISOString()).toBe(
      '2026-03-29T02:00:00.000Z',
    );
  });

  it('propriété : toujours un tick de clôture, dans le futur, à moins de 25 heures', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_000_000_000_000 }), (ms) => {
        const close = nextDailyClose(new Date(ms), PARIS);
        expect(close.getTime()).toBeGreaterThan(ms);
        expect(close.getTime() - ms).toBeLessThanOrEqual(
          25 * 3_600_000 + PARIS.tickMinutes * 60_000,
        );
        expect(isDailyClose(tickIndexAt(close, PARIS.tickMinutes), PARIS)).toBe(true);
      }),
    );
  });
});

describe('jour de jeu et instant de clôture', () => {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  const closeOf = (iso: string, clock: DayClock = PARIS) =>
    dailyCloseAt(day(iso), clock).toISOString();

  it('le jour de jeu commence à la clôture : avant 04 h 00 à Paris, c’est encore la veille', () => {
    expect(gameDayAt(new Date('2026-11-14T02:59:59.999Z'), PARIS)).toBe(day('2026-11-13'));
    expect(gameDayAt(new Date('2026-11-14T03:00:00Z'), PARIS)).toBe(day('2026-11-14'));
    expect(gameDayAt(new Date('2026-11-14T23:30:00Z'), PARIS)).toBe(day('2026-11-14'));
    // En été, 04 h 00 à Paris est 02 h 00 UTC.
    expect(gameDayAt(new Date('2026-07-15T01:59:59Z'), PARIS)).toBe(day('2026-07-14'));
    expect(gameDayAt(new Date('2026-07-15T02:00:00Z'), PARIS)).toBe(day('2026-07-15'));
  });

  it('la date d’un jour de jeu est le jour civil local de la clôture qui l’ouvre, quel que soit le fuseau', () => {
    expect(gameDayDate(day('2026-11-14')).toISOString()).toBe('2026-11-14T00:00:00.000Z');
    // Cent tirages, à partir du 1er janvier 2000 : un jour civil qu'un fuseau a sauté n'a pas de
    // clôture à lui (Kiritimati n'a pas eu de 31 décembre 1994 en changeant de côté de la ligne de date).
    fc.assert(
      fc.property(
        fc.integer({ min: day('2000-01-01'), max: day('2100-01-01') }),
        fc.integer({ min: 0, max: 23 }),
        fc.constantFrom('Europe/Paris', 'Pacific/Kiritimati', 'America/Los_Angeles', 'UTC'),
        (gameDay, dailyCloseHour, timezone) => {
          const opening = localTime(dailyCloseAt(gameDay, { dailyCloseHour, timezone }), timezone);
          const civil = Date.UTC(opening.year, opening.month - 1, opening.day);
          expect(gameDayDate(gameDay).getTime()).toBe(civil);
        },
      ),
    );
  });

  it('la clôture d’un jour est celle que porte le tick de clôture, hiver, été et changements d’heure', () => {
    expect(closeOf('2026-01-15')).toBe('2026-01-15T03:00:00.000Z');
    expect(closeOf('2026-07-15')).toBe('2026-07-15T02:00:00.000Z');
    expect(closeOf('2026-03-29')).toBe('2026-03-29T02:00:00.000Z');
    expect(closeOf('2026-10-25')).toBe('2026-10-25T03:00:00.000Z');
    const year = Array.from({ length: 365 }, (_, offset) =>
      dailyCloseAt(day('2026-01-01') + offset, PARIS).toISOString(),
    );
    expect(year).toEqual(closesBetween('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'));
  });

  it('heure de clôture sautée ou répétée par le changement d’heure : une clôture ce jour-là quand même', () => {
    const two = { ...PARIS, dailyCloseHour: 2 };
    // 29 mars 2026 : 02 h 00 n'existe pas à Paris (01 h 00 UTC : 02 h 00 devient 03 h 00).
    expect(closeOf('2026-03-29', two)).toBe('2026-03-29T01:00:00.000Z');
    expect(closesBetween('2026-03-29T00:00:00Z', '2026-03-30T00:00:00Z', two)).toEqual([]);
    // 25 octobre 2026 : 02 h 00 a lieu deux fois (00 h 00 et 01 h 00 UTC) ; la première ouvre le jour.
    expect(closeOf('2026-10-25', two)).toBe('2026-10-25T00:00:00.000Z');
    // Aux bords de la carte : UTC+14, UTC−11, et un fuseau décalé de trois quarts d'heure.
    expect(closeOf('2026-11-14', { dailyCloseHour: 0, timezone: 'Pacific/Kiritimati' })).toBe(
      '2026-11-13T10:00:00.000Z',
    );
    expect(closeOf('2026-11-14', { dailyCloseHour: 23, timezone: 'Pacific/Pago_Pago' })).toBe(
      '2026-11-15T10:00:00.000Z',
    );
    expect(closeOf('2026-11-14', { dailyCloseHour: 4, timezone: 'Asia/Kathmandu' })).toBe(
      '2026-11-13T22:15:00.000Z',
    );
  });

  it('propriété : la clôture est le premier instant de son jour de jeu, et les clôtures se suivent à un jour près', () => {
    const timezone = fc.constantFrom(
      'Europe/Paris',
      'UTC',
      'Asia/Kathmandu',
      'Australia/Lord_Howe',
      'America/St_Johns',
      'Pacific/Kiritimati',
      'Pacific/Pago_Pago',
    );
    fc.assert(
      fc.property(
        fc.integer({ min: day('2020-01-01'), max: day('2040-01-01') }),
        fc.integer({ min: 0, max: 23 }),
        timezone,
        (gameDay, dailyCloseHour, zone) => {
          const clock = { dailyCloseHour, timezone: zone };
          const close = dailyCloseAt(gameDay, clock).getTime();
          expect(gameDayAt(new Date(close), clock)).toBe(gameDay);
          expect(gameDayAt(new Date(close - 1), clock)).toBe(gameDay - 1);
          const gap = dailyCloseAt(gameDay + 1, clock).getTime() - close;
          // 23, 24 ou 25 heures : le changement d'heure déplace la clôture d'une heure au plus.
          expect(Math.abs(gap - 86_400_000)).toBeLessThanOrEqual(3_600_000);
        },
      ),
    );
  });

  it('refuse un jour de jeu qui n’est pas un entier', () => {
    expect(() => dailyCloseAt(20_000.5, PARIS)).toThrow(RangeError);
    expect(() => dailyCloseAt(Number.NaN, PARIS)).toThrow(RangeError);
  });
});

import { describe, expect, it } from 'vitest';
import { nextClose, parseClockRules } from './clock-rules';

const paris = { dailyCloseHour: 4, timezone: 'Europe/Paris' };

describe('horloge du monde (vue clock_rules)', () => {
  it('lit l’heure de clôture et le fuseau ; une ligne absente ou un champ nul n’annoncent rien', () => {
    expect(parseClockRules({ daily_close_hour: 4, timezone: 'Europe/Paris' })).toEqual({
      clock: paris,
    });
    // Fuseau inconnu de la base.
    expect(parseClockRules({ daily_close_hour: 4, timezone: null })).toEqual({ clock: null });
    // Version en vigueur sans section d'horloge.
    expect(parseClockRules({ daily_close_hour: null, timezone: null })).toEqual({ clock: null });
    // Aucune version en vigueur : la vue ne rend aucune ligne.
    expect(parseClockRules(null)).toEqual({ clock: null });
    // Heure 0 : une clôture à minuit, pas une horloge absente.
    expect(parseClockRules({ daily_close_hour: 0, timezone: 'UTC' })).toEqual({
      clock: { dailyCloseHour: 0, timezone: 'UTC' },
    });
  });

  it('rend null pour une ligne mal formée : la lecture est en échec, pas sans clôture', () => {
    expect(parseClockRules({ daily_close_hour: 24, timezone: 'Europe/Paris' })).toBeNull();
    expect(parseClockRules({ daily_close_hour: -1, timezone: 'Europe/Paris' })).toBeNull();
    expect(parseClockRules({ daily_close_hour: 4.5, timezone: 'Europe/Paris' })).toBeNull();
    expect(parseClockRules({ daily_close_hour: 4, timezone: '' })).toBeNull();
    expect(parseClockRules({ timezone: 'Europe/Paris' })).toBeNull();
    expect(parseClockRules('4')).toBeNull();
  });

  it('donne la prochaine clôture, le jour même avant l’heure, le lendemain après', () => {
    // 3 h à Paris (heure d'hiver, UTC+1) : la clôture de 4 h est dans une heure.
    expect(nextClose(new Date('2026-11-20T02:00:00Z'), paris)?.toISOString()).toBe(
      '2026-11-20T03:00:00.000Z',
    );
    // 11 h à Paris : celle du lendemain ; à l'heure pile, la suivante.
    expect(nextClose(new Date('2026-11-20T10:00:00Z'), paris)?.toISOString()).toBe(
      '2026-11-21T03:00:00.000Z',
    );
    expect(nextClose(new Date('2026-11-20T03:00:00Z'), paris)?.toISOString()).toBe(
      '2026-11-21T03:00:00.000Z',
    );
    // Heure d'été (UTC+2) : la clôture de 4 h est à 2 h UTC.
    expect(nextClose(new Date('2026-07-01T10:00:00Z'), paris)?.toISOString()).toBe(
      '2026-07-02T02:00:00.000Z',
    );
    expect(nextClose(new Date('2026-11-20T10:00:00Z'), null)).toBeNull();
    expect(nextClose(new Date('2026-11-20T10:00:00Z'), undefined)).toBeNull();
  });

  it('un fuseau que le navigateur ne connaît pas n’annonce rien, sans lever d’erreur', () => {
    expect(
      nextClose(new Date('2026-11-20T10:00:00Z'), { dailyCloseHour: 4, timezone: 'Mars/Olympus' }),
    ).toBeNull();
  });
});

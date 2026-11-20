import { describe, expect, it } from 'vitest';
import { nextClose, parseClockRules } from './clock-rules';

const paris = { dailyCloseHour: 4, timezone: 'Europe/Paris' };

describe('horloge du monde (vue clock_rules)', () => {
  it('lit l’heure de clôture et le fuseau ; un fuseau nul ou une ligne absente n’annoncent rien', () => {
    expect(parseClockRules({ daily_close_hour: 4, timezone: 'Europe/Paris' })).toEqual({
      clock: paris,
    });
    expect(parseClockRules({ daily_close_hour: 4, timezone: null })).toEqual({ clock: null });
    expect(parseClockRules(null)).toEqual({ clock: null });
  });

  it('rend null pour une ligne mal formée : la lecture est en échec, pas sans clôture', () => {
    expect(parseClockRules({ daily_close_hour: 24, timezone: 'Europe/Paris' })).toBeNull();
    expect(parseClockRules({ timezone: 'Europe/Paris' })).toBeNull();
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
    expect(nextClose(new Date('2026-11-20T10:00:00Z'), null)).toBeNull();
  });
});

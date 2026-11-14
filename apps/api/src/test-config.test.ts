import { nextDailyClose } from '@oikos/sim';
import { describe, expect, it } from 'vitest';
import { FAR_CLOSE_MARGIN_MS, farCloseClock, TEST_CONFIG } from './test-config';

// L'horloge des tests d'intégration de programmation et d'annulation, à heure fixée : ces tests ont
// échoué chaque nuit de 23 h 00 à 04 h 00 (heure de Paris), faute d'avoir compté avec ces instants.
const close = (now: string, clock = farCloseClock(new Date(now))) =>
  nextDailyClose(new Date(now), clock).toISOString();
const defaultClose = (now: string) => close(now, TEST_CONFIG.config.clock);

describe('horloge de test à clôture lointaine', () => {
  it('la configuration de test clôt à 04 h 00, heure de Paris', () => {
    expect(TEST_CONFIG.config.clock).toMatchObject({ dailyCloseHour: 4, timezone: 'Europe/Paris' });
    expect(defaultClose('2026-11-14T21:59:00Z')).toBe('2026-11-15T03:00:00.000Z');
  });

  it('choisit minuit tant qu’il est à plus d’une heure, midi sinon', () => {
    // 14 novembre 2026, heure d'hiver : minuit à Paris = 23 h 00 UTC, midi = 11 h 00 UTC.
    expect(close('2026-11-14T21:59:00Z')).toBe('2026-11-14T23:00:00.000Z');
    expect(close('2026-11-14T21:59:59.999Z')).toBe('2026-11-14T23:00:00.000Z');
    expect(close('2026-11-14T22:00:00Z')).toBe('2026-11-15T11:00:00.000Z');
    expect(close('2026-11-14T22:59:59.999Z')).toBe('2026-11-15T11:00:00.000Z');
    expect(close('2026-11-14T23:00:00Z')).toBe('2026-11-15T23:00:00.000Z');
  });

  it('sa clôture tombe avant celle de 04 h 00 le jour, après elle de 23 h 00 à 04 h 00', () => {
    const afterDefault = (now: string) => Date.parse(close(now)) > Date.parse(defaultClose(now));
    // Le jour, rien de ce qui est programmé à 04 h 00 n'échoit avant la clôture de test.
    for (const now of [
      '2026-11-14T03:00:00Z',
      '2026-11-14T12:00:00Z',
      '2026-11-14T21:59:59.999Z',
    ]) {
      expect([now, afterDefault(now)]).toEqual([now, false]);
    }
    // La nuit, une programmation à 04 h 00 entre en vigueur avant la clôture de test : un test ne peut
    // pas tenir « la version en vigueur maintenant » pour celle que cette clôture trouvera.
    for (const now of [
      '2026-11-14T22:00:00Z',
      '2026-11-14T22:04:07Z',
      '2026-11-14T23:00:00Z',
      '2026-11-15T02:59:59.999Z',
    ]) {
      expect([now, afterDefault(now)]).toEqual([now, true]);
    }
  });

  it('toujours à plus d’une heure : une année parcourue, et les jours de changement d’heure', () => {
    const instants: number[] = [];
    // Un pas de 23 h 01 : l'heure du jour recule de 59 minutes à chaque pas, toutes les heures sont visitées.
    const [from, to] = [Date.parse('2027-01-01T00:00:00Z'), Date.parse('2028-01-01T00:00:00Z')];
    for (let ms = from; ms < to; ms += 1381 * 60_000) instants.push(ms);
    for (const day of ['2027-03-27', '2027-03-28', '2027-10-30', '2027-10-31']) {
      const start = Date.parse(`${day}T00:00:00Z`);
      for (let step = 0; step < 48; step++) instants.push(start + step * 30 * 60_000 - 1);
    }
    for (const ms of instants) {
      const now = new Date(ms);
      const clock = farCloseClock(now);
      expect([0, 12]).toContain(clock.dailyCloseHour);
      expect(nextDailyClose(now, clock).getTime() - ms).toBeGreaterThan(FAR_CLOSE_MARGIN_MS);
    }
  });
});

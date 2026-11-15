// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createServerClock, serverClock, syncServerClock } from './server-clock';

describe('heure du serveur', () => {
  it('suit l’horloge du navigateur tant qu’aucune réponse n’est lue', () => {
    const clock = createServerClock(() => 1_000_000);
    expect(clock.now().getTime()).toBe(1_000_000);
  });

  it('se cale sur l’en-tête Date, au milieu de la seconde et de l’aller-retour', () => {
    let local = Date.parse('2026-11-15T10:00:00.000Z');
    const clock = createServerClock(() => local);
    // Le navigateur retarde de quatre heures ; la requête a mis 200 ms.
    clock.observe('Sun, 15 Nov 2026 14:00:00 GMT', local - 200, local);
    expect(clock.now().toISOString()).toBe('2026-11-15T14:00:00.600Z');
    local += 60_000;
    expect(clock.now().toISOString()).toBe('2026-11-15T14:01:00.600Z');
  });

  it('ignore un en-tête absent ou illisible, et une mesure incohérente', () => {
    const local = 5_000;
    const clock = createServerClock(() => local);
    clock.observe(null, 0, local);
    clock.observe('pas une date', 0, local);
    clock.observe('Sun, 15 Nov 2026 14:00:00 GMT', local + 10, local);
    expect(clock.now().getTime()).toBe(local);
  });

  it('lit l’heure par la route de santé ; une panne ne change rien', async () => {
    const date = new Date(Date.now() + 3 * 3_600_000).toUTCString();
    await syncServerClock(async () => new Response('{}', { headers: { Date: date } }));
    const ahead = serverClock.now().getTime() - Date.now();
    expect(ahead).toBeGreaterThan(3 * 3_600_000 - 2_000);
    expect(ahead).toBeLessThan(3 * 3_600_000 + 2_000);
    await syncServerClock(vi.fn<typeof fetch>(async () => Promise.reject(new Error('offline'))));
    expect(Math.abs(serverClock.now().getTime() - Date.now() - ahead)).toBeLessThan(1_000);
  });
});

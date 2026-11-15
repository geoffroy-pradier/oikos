// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createServerClock, serverClock, syncServerClock } from './server-clock';

describe('heure du serveur', () => {
  it('suit l’horloge du navigateur tant qu’aucune réponse n’est lue', () => {
    const clock = createServerClock(() => 1_000_000);
    expect(clock.now().getTime()).toBe(1_000_000);
  });

  it('horloge décalée : se cale au milieu de l’intervalle permis par l’en-tête', () => {
    let local = Date.parse('2026-11-15T10:00:00.000Z');
    const clock = createServerClock(() => local);
    // Le navigateur retarde de quatre heures ; la requête a mis 200 ms. À la réception, le serveur est
    // entre 14:00:00.000 et 14:00:01.199 : on retient le milieu.
    clock.observe('Sun, 15 Nov 2026 14:00:00 GMT', local - 200, local);
    expect(clock.now().toISOString()).toBe('2026-11-15T14:00:00.599Z');
    local += 60_000;
    expect(clock.now().toISOString()).toBe('2026-11-15T14:01:00.599Z');
    // Navigateur en avance : même règle, l'erreur ne penche pas vers l'avance.
    clock.observe('Sun, 15 Nov 2026 09:00:00 GMT', local - 200, local);
    expect(clock.now().toISOString()).toBe('2026-11-15T09:00:00.599Z');
  });

  it('l’écart retenu reste toujours dans l’intervalle permis, à une demi-seconde et demi-aller-retour près', () => {
    // Écarts réels, instants de lecture et durées d'aller-retour variés (table fixe, reproductible).
    for (const real of [-14_400_000, -1_500, -999, -1, 0, 1, 999, 1_500, 14_400_000])
      for (const rtt of [0, 1, 200, 3_000])
        for (const at of [0, 0.3, 1]) {
          const sentAt = 1_000_000_123;
          const receivedAt = sentAt + rtt;
          const t = sentAt + Math.round(at * rtt);
          const header = new Date(Math.floor((t + real) / 1000) * 1000).toUTCString();
          const clock = createServerClock(() => receivedAt);
          clock.observe(header, sentAt, receivedAt);
          const offset = clock.now().getTime() - receivedAt;
          if (real === 0) expect(offset).toBe(0);
          expect(Math.abs(offset - real)).toBeLessThanOrEqual(1000 + rtt);
        }
  });

  it('garde l’horloge du navigateur quand l’en-tête lui donne raison, même à la seconde tronquée', () => {
    // Même machine : l'en-tête annonce la seconde entamée, le navigateur est à 0,9 s dedans.
    const local = Date.parse('2026-11-15T10:00:00.900Z');
    const clock = createServerClock(() => local);
    clock.observe('Sun, 15 Nov 2026 10:00:00 GMT', local - 30, local);
    expect(clock.now().getTime()).toBe(local);
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
    const health = vi.fn<typeof fetch>(async () => new Response('{}', { headers: { Date: date } }));
    await syncServerClock(health);
    // Jamais servie par un cache : l'heure lue est celle de la réponse.
    expect(health).toHaveBeenCalledWith('/api/health', { cache: 'no-store' });
    const ahead = serverClock.now().getTime() - Date.now();
    expect(ahead).toBeGreaterThan(3 * 3_600_000 - 2_000);
    expect(ahead).toBeLessThan(3 * 3_600_000 + 2_000);
    await syncServerClock(vi.fn<typeof fetch>(async () => Promise.reject(new Error('offline'))));
    expect(Math.abs(serverClock.now().getTime() - Date.now() - ahead)).toBeLessThan(1_000);
  });
});

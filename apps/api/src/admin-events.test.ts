import { describe, expect, it } from 'vitest';
import { adminEventsData } from './admin-read';

// Réponse du calendrier des événements d'Olympe (#267, #446), hors base : champs choisis par le schéma partagé,
// liste coupée signalée.
const NOW = new Date('2026-11-20T12:00:00.000Z');
const row = (n: number) => ({
  id: `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  world: 'archipel',
  model: 'storm',
  city: 'elaia',
  otherCity: 'kalliste',
  goodId: null,
  startsAt: new Date(NOW.getTime() - n * 60_000),
  endsAt: new Date(NOW.getTime() + 3_600_000),
  magnitudeBps: 2_500,
  plannedDay: 7,
});

describe('adminEventsData', () => {
  it('rend les champs du schéma partagé, jamais une colonne lue en plus comme la graine', () => {
    const data = adminEventsData(NOW, [{ ...row(1), seed: 'ab'.repeat(32), created_at: NOW }]);
    expect(data).toEqual({
      now: '2026-11-20T12:00:00.000Z',
      pastDays: 30,
      events: [
        {
          id: '01900000-0000-7000-8000-000000000001',
          world: 'archipel',
          model: 'storm',
          city: 'elaia',
          otherCity: 'kalliste',
          goodId: null,
          startsAt: '2026-11-20T11:59:00.000Z',
          endsAt: '2026-11-20T13:00:00.000Z',
          magnitudeBps: 2_500,
          plannedDay: 7,
        },
      ],
      truncated: false,
    });
    expect(JSON.stringify(data)).not.toContain('ab'.repeat(32));
  });

  it('signale une liste coupée quand la lecture trouve plus de lignes que la limite (1 000), et rend la limite', () => {
    const rows = Array.from({ length: 1_001 }, (_, n) => row(n + 1));
    const cut = adminEventsData(NOW, rows);
    expect([cut.truncated, cut.events.length, cut.events.at(-1)?.id]).toEqual([
      true,
      1_000,
      rows[999]?.id,
    ]);
    expect(adminEventsData(NOW, rows.slice(0, 1_000)).truncated).toBe(false);
  });

  it('refuse une ligne hors du contrat : modèle inconnu, ampleur hors bornes', () => {
    expect(() => adminEventsData(NOW, [{ ...row(1), model: 'plague' }])).toThrow();
    expect(() => adminEventsData(NOW, [{ ...row(1), magnitudeBps: 10_001 }])).toThrow();
  });
});

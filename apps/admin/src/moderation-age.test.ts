import { describe, expect, it } from 'vitest';
import { hoursSince, staleReportHours } from './moderation-age';

const NOW = '2026-11-18T12:00:00Z';
const queue = (...createdAt: string[]) => ({
  now: NOW,
  queue: createdAt.map((at) => ({ reports: [{ createdAt: at }] })),
});
// Le type de la file est large : seul ce que la fonction lit est fourni.
const stale = (...createdAt: string[]) =>
  staleReportHours(queue(...createdAt) as unknown as Parameters<typeof staleReportHours>[0]);

describe('alerte des signalements en attente (15.5)', () => {
  it('« plus de 24 h » : exactement 24 h n’alerte pas, une seconde de plus si', () => {
    expect(stale('2026-11-17T12:00:00Z')).toBeNull();
    expect(stale('2026-11-17T11:59:59Z')).toBe(24);
  });
  it('compte le plus ancien signalement de toute la file, en heures entières', () => {
    expect(stale('2026-11-18T11:00:00Z', '2026-11-16T09:30:00Z', '2026-11-17T20:00:00Z')).toBe(50);
  });
  it('file vide, absente ou illisible : pas d’alerte', () => {
    expect(stale()).toBeNull();
    expect(staleReportHours(null)).toBeNull();
    expect(
      staleReportHours({ now: NOW } as unknown as Parameters<typeof staleReportHours>[0]),
    ).toBeNull();
  });
  it('l’ancienneté ne devient jamais négative', () => {
    expect(hoursSince('2026-11-18T12:00:05Z', NOW)).toBe(0);
    expect(hoursSince('2026-11-18T09:59:00Z', NOW)).toBe(2);
  });
});

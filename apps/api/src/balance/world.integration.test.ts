import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { benchFirstDay, closeOf, createWorld, openBench } from './city';
import { SLUGS, worldConfig } from './world';

/*
 * Premier jour d'un monde du banc (#663) : il ne dépend ni de l'heure réelle du lancement ni de la durée jouée.
 * L'horloge réelle est simulée de part et d'autre de la clôture de 04:00 (heure de Paris).
 */
const bench = openBench({ config: worldConfig });
beforeAll(() => bench.start());
afterAll(() => bench.stop());
afterEach(() => vi.useRealTimers());

const firstDayAt = async (instant: string, days: number) => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(instant) });
  const [city] = await createWorld(bench, days, SLUGS, 'graine-premier-jour');
  vi.useRealTimers();
  if (!city) throw new Error('No city created');
  return city;
};

it("deux parties lancées de part et d'autre de la clôture jouent les mêmes jours de jeu", async () => {
  // 02:59 et 03:01 UTC : 03:59 et 04:01 à Paris en hiver, avant et après la clôture ; puis un été et un autre jour.
  const [before, after, summer, later] = [
    await firstDayAt('2026-11-20T02:59:00Z', 5),
    await firstDayAt('2026-11-20T03:01:00Z', 5),
    await firstDayAt('2026-12-01T12:00:00Z', 5),
    await firstDayAt('2027-06-30T12:00:00Z', 40),
  ];
  expect(before.firstDay).toBe(benchFirstDay());
  for (const city of [after, summer, later]) expect(city.firstDay).toBe(before.firstDay);
  expect(closeOf(after, 3)).toEqual(closeOf(before, 3));
});

it("refuse un banc dont les jours finiraient après l'instant de la base", async () => {
  await expect(createWorld(bench, 10_000, SLUGS)).rejects.toThrow(/does not end in the past/);
});

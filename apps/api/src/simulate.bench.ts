import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBench } from './balance/city';
import { recipeMargins } from './balance/measures';
import { compare, indicatorsOf, type Indicators } from './balance/report';
import { playWorld } from './balance/run';
import { SLUGS, WINDOW, worldConfig } from './balance/world';

/*
 * Simulateur d'équilibrage (#284) : mêmes graine et configuration, même rapport. Deux parties courtes du banc
 * des quatre cités, sur la même graine, rendent les mêmes indicateurs, donc un rapport sans aucun écart ; les
 * deux joueraient le même monde neuf chacun, ce que fait la commande pour la référence et la candidate.
 */
const bench = openBench({ config: worldConfig });
beforeAll(() => bench.start());
afterAll(() => bench.stop());

/**
 * Orders, then trades, of a run, each in the order of its own sequence, houses and cities by rank, without
 * identifiers. The two sequences are distinct and shared by all worlds: their interleaving says nothing.
 */
const traces: string[][] = [];
const trace = async (run: Awaited<ReturnType<typeof playWorld>>) => {
  const houses = run.houses.map((house) => house.houseId);
  const cities = run.cities.map((city) => city.cityId);
  const rows = await sql<{ line: string }>`
    select * from (
      select 1 as kind, o.seq as seq, 'order ' || o.city_id || ' ' || o.house_id || ' ' || o.side || ' ' || o.good_id || ' ' || o.price || ' ' || o.quantity || ' ' || o.status as line
        from game.orders o where o.world_id = ${run.world.worldId}
      union all
      select 2, t.seq, 'trade ' || o.city_id || ' ' || coalesce(b.house_id::text, 'npc') || ' ' || o.house_id || ' ' || o.good_id || ' ' || t.price || ' ' || t.quantity
        from game.trades t join game.orders o on o.id = t.sell_order_id left join game.orders b on b.id = t.buy_order_id
        where t.world_id = ${run.world.worldId}) x order by kind, seq`.execute(run.world.db);
  const rank = (line: string) =>
    line
      .split(' ')
      .map((word) => {
        const house = houses.indexOf(word);
        const city = cities.indexOf(word);
        return house >= 0 ? `h${house}` : city >= 0 ? `c${city}` : word;
      })
      .join(' ');
  traces.push(rows.rows.map((row) => rank(row.line)));
};

const indicators = async (seed: string): Promise<Indicators> => {
  const run = await playWorld(bench, { warmup: 3, measured: 4, seed });
  await trace(run);
  const margins = recipeMargins(run.days.slice(-WINDOW));
  return indicatorsOf(run.days, margins, SLUGS, WINDOW);
};

it('mêmes graine et configuration : même rapport', { timeout: 10 * 60_000 }, async () => {
  const [first, second] = [
    await indicators('graine-simulateur-a'),
    await indicators('graine-simulateur-a'),
  ];
  expect(Object.keys(first).length).toBeGreaterThan(50);
  // Les ordres et les échanges d'abord, dans leur ordre : la première divergence nomme sa cause mieux qu'un écart de rapport.
  const [a = [], b = []] = traces;
  expect(a.length).toBeGreaterThan(0);
  const at = a.findIndex((line, index) => line !== b[index]);
  expect(
    at < 0 && a.length === b.length ? 'same' : `first difference at ${at}: ${a[at]} | ${b[at]}`,
  ).toBe('same');
  expect(second).toEqual(first);
  const report = compare(first, second, { seed: 'graine-simulateur-a', days: 4 });
  expect(Object.values(report.deltas).every((delta) => delta === null || delta === 0)).toBe(true);
});

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  accounts,
  closeDay,
  closeOf,
  createWorld,
  foundHouses,
  MINUTE,
  openBench,
  reconcile,
  tickDay,
  treasuryOf,
  upkeepDue,
} from './balance/city';
import { morning, seller } from './balance/strategy';
import {
  MEASURED,
  SETTLEMENTS,
  SLUGS,
  WARMUP,
  WORLD_SEED,
  worldConfig,
  type Settlement,
} from './balance/world';
import { sql } from 'kysely';

/*
 * Banc d'équilibrage des quatre cités (#281, docs/specs/05-economie.md 5.2 et 5.5), dans un monde à part, sur
 * la graine `WORLD_SEED` : les quatre cités de la configuration initiale, leurs maisons scriptées selon leur
 * terroir (`balance/world.ts`), jouées comme celles du banc d'une cité de #78 (`balance.integration.test.ts`, qui
 * garde ses bornes). Il tourne dans son propre job `ci` (`pnpm test:balance`), pas avec les tests d'intégration.
 * Il ne borne pas l'économie, calibrée par #283 : il vérifie que le grand livre se rapproche des flux comptés
 * et que chaque cité a tourné.
 */
const bench = openBench({ config: worldConfig });
beforeAll(() => bench.start());
afterAll(() => bench.stop());

/** Durée maximale du banc, en minutes : au-delà, le test échoue (le job `ci` en laisse davantage). */
const MAX_MINUTES = 15;

it(
  'quatre cités, 40 jours : grand livre rapproché',
  { timeout: MAX_MINUTES * 60_000 },
  async () => {
    const startedAt = Date.now();
    const cities = await createWorld(bench, WARMUP + MEASURED, SLUGS, WORLD_SEED);
    const settlements: Settlement[] = [];
    for (const city of cities)
      settlements.push({
        city,
        houses: (await foundHouses(city, SETTLEMENTS[city.slug as (typeof SLUGS)[number]])).map(
          seller,
        ),
      });
    const [world] = cities;
    if (!world) throw new Error('No city created');
    const houses = settlements.flatMap((settlement) => settlement.houses);

    let [upkeep, acquisitions] = [0, 0];
    for (let day = 0; day < WARMUP + MEASURED; day++) {
      upkeep += upkeepDue(world, houses, day);
      await closeDay(world, day);
      const now = new Date(closeOf(world, day).getTime() + MINUTE);
      for (const { city, houses: own } of settlements)
        for (const house of own) acquisitions += await morning(city, house, now);
      // Un tick d'une heure par heure du jour de jeu : 24, sauf au changement d'heure.
      const hours =
        (closeOf(world, day + 1).getTime() - closeOf(world, day).getTime()) / (60 * MINUTE);
      expect(await tickDay(world, day)).toBe(hours);
    }

    // Robinets, puits et trésors des cités rapprochés des flux comptés ; puis la masse en circulation.
    const ledger = await reconcile(world, houses.length, {
      sink_upkeep: upkeep,
      sink_site_acquisition: acquisitions,
    });
    expect(ledger.actual).toEqual(ledger.expected);
    expect(ledger.supply).toBe(ledger.mass);
    // Le trésor de chaque cité reçoit la taxe des échanges de son marché, et rien d'autre.
    const treasuries = await treasuryOf(world);
    for (const { city } of settlements)
      expect(treasuries.get(city.cityId), `${city.slug} : trésor`).toBe(
        ledger.treasuries.get(city.cityId) ?? 0,
      );
    const minutes = (Date.now() - startedAt) / 60_000;
    expect(minutes).toBeLessThan(MAX_MINUTES);

    // Chaque cité a tourné : des achats de PNJ sur son marché, une population qui ne s'est pas vidée.
    for (const { city } of settlements) {
      const bought = await sql<{ n: string }>`select count(*) as n from game.trades t
        join game.orders o on o.id = t.sell_order_id
        where t.buy_order_id is null and o.city_id = ${city.cityId}`.execute(world.db);
      expect(Number(bought.rows[0]?.n), `${city.slug} : achats des PNJ`).toBeGreaterThan(0);
      const population = await sql<{ n: string }>`select coalesce(sum(population), 0) as n
        from game.npc_population where city_id = ${city.cityId}`.execute(world.db);
      expect(Number(population.rows[0]?.n), `${city.slug} : population`).toBeGreaterThan(0);
    }
    expect(acquisitions).toBeGreaterThan(0);
    expect((await accounts(world)).supply).toBe(ledger.supply);
  },
);

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  closeDay,
  closeOf,
  createWorld,
  foundHouses,
  lastSeq,
  MINUTE,
  openBench,
  reconcile,
  tickDay,
  treasuryOf,
  upkeepDue,
  wagesDue,
} from './balance/city';
import { housingMorning, lodgingDue, newHousing, propertyUpkeepDue } from './balance/housing';
import { morning, seller } from './balance/strategy';
import { actAfterTick, hireSteward, type Steward } from './balance/steward';
import { traderMorning, type Prices, type Trader } from './balance/trade';
import { measureDay, publish, recipeMargins, type DayMeasure } from './balance/measures';
import {
  MEASURED,
  SETTLEMENTS,
  SLUGS,
  STEWARD_ROLES,
  TRADER,
  TRADER_HOMES,
  WAGES,
  WARMUP,
  WINDOW,
  WORLD_SEED,
  WORLD_STEPS,
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
    // Négociants : une maison dans chacune des cités d'attache, avec le site de départ de la cité.
    const traders: Trader[] = [];
    for (const slug of TRADER_HOMES) {
      const home = cities.find((city) => city.slug === slug);
      if (!home) throw new Error(`No city ${slug}`);
      for (const house of await foundHouses(home, [TRADER]))
        traders.push({ ...seller(house), home, waitedDays: 0 });
    }
    const houses = [...settlements.flatMap((settlement) => settlement.houses), ...traders];
    // Maisons et leur cité.
    const residents = [
      ...settlements.flatMap(({ city, houses: own }) => own.map((house) => ({ city, house }))),
      ...traders.map((trader) => ({ city: trader.home, house: trader })),
    ];
    const housing = newHousing();
    const prices: Prices = new Map();

    const days: DayMeasure[] = [];
    const measured: Record<string, number> = {};
    const stewards: Steward[] = [];
    const operations = { acted: 0, refused: 0, failed: 0 };
    let [seq, at, upkeep, acquisitions, ships] = [await lastSeq(world), new Date(0), 0, 0, 0];
    let [wages, estateUpkeep, lodging] = [0, 0, 0];
    for (let day = 0; day < WARMUP + MEASURED; day++) {
      upkeep += upkeepDue(world, houses, day);
      estateUpkeep += propertyUpkeepDue(world, housing, day);
      lodging += await lodgingDue(world, residents, day);
      // Salaires de la clôture : les travailleurs des sites, et les intendants embauchés avant elle (payés d'avance).
      wages += wagesDue(world, houses, day, WAGES.workerOboles);
      wages += stewards.filter((steward) => steward.hiredDay < day).length * WAGES.stewardOboles;
      await closeDay(world, day);
      const now = new Date(closeOf(world, day).getTime() + MINUTE);
      for (const { city, houses: own } of settlements)
        for (const house of own) acquisitions += await morning(city, house, now);
      for (const { city, houses: own } of settlements)
        for (const house of own.filter((each) => STEWARD_ROLES.includes(each.role.name))) {
          const hired = await hireSteward(city, house, day, now, stewards);
          if (hired) stewards.push(hired);
        }
      for (const { city, house } of residents) await housingMorning(city, house, now, housing);
      for (const trader of traders) ships += await traderMorning(cities, trader, now, prices);
      // Un tick d'une heure par heure du jour de jeu : 24, sauf au changement d'heure.
      const hours =
        (closeOf(world, day + 1).getTime() - closeOf(world, day).getTime()) / (60 * MINUTE);
      expect(
        await tickDay(world, day, WORLD_STEPS, async (index) => {
          const run = await actAfterTick(world, await bench.loader.at(), index);
          for (const key of ['acted', 'refused', 'failed'] as const) operations[key] += run[key];
        }),
      ).toBe(hours);
      // Mesures du jour ; la mise en route n'est pas publiée, mais le rang et l'instant avancent.
      const measure = await measureDay(settlements, day, { seq, at });
      [seq, at] = [
        await lastSeq(world),
        (await sql<{ now: Date }>`select clock_timestamp() as now`.execute(world.db)).rows[0]
          ?.now ?? at,
      ];
      for (const [key, net] of Object.entries(measure.flows['world'] ?? {}))
        measured[key] = (measured[key] ?? 0) + net;
      // Prix observés : le dernier prix moyen de chaque bien dans chaque cité où il s'est échangé.
      for (const [slug, goods] of Object.entries(measure.traded)) {
        const known = prices.get(slug) ?? new Map<string, number>();
        for (const [goodId, good] of Object.entries(goods))
          known.set(goodId, good.turnover / good.volume);
        prices.set(slug, known);
      }
      if (day >= WARMUP) days.push(measure);
    }

    // Robinets, puits et trésors des cités rapprochés des flux comptés ; puis la masse en circulation.
    const ledger = await reconcile(world, houses.length, {
      sink_upkeep: upkeep,
      sink_site_acquisition: acquisitions,
      sink_ship_purchase: ships,
      sink_npc_wages: wages,
      sink_property_purchase: housing.purchased,
      sink_property_works: housing.works,
      sink_property_upkeep: estateUpkeep,
      sink_npc_lodging: lodging,
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
      const net = (key: string) =>
        days.reduce((sum, day) => sum + (day.flows[city.slug]?.[key] ?? 0), 0);
      expect(net('faucet_npc_purchases'), `${city.slug} : achats des PNJ`).toBeGreaterThan(0);
      expect(days.at(-1)?.population[city.slug] ?? 0, `${city.slug} : population`).toBeGreaterThan(
        0,
      );
    }
    expect(acquisitions).toBeGreaterThan(0);
    // Les maisons ont payé leurs salaires, leurs intendants compris, et leurs intendants ont exécuté leurs règles.
    expect(wages).toBeGreaterThan(0);
    expect(stewards.length).toBeGreaterThan(0);
    expect(operations.acted, 'opérations des intendants').toBeGreaterThan(0);
    expect(operations.failed).toBe(0);
    const unpaid = await sql<{ n: string }>`select count(*) as n from game.stewards
      where world_id = ${world.worldId} and dismissed_at is null and unpaid_since is not null`.execute(
      world.db,
    );
    expect(Number(unpaid.rows[0]?.n), 'intendants impayés').toBe(
      stewards.filter((steward) => steward.hiredDay === WARMUP + MEASURED - 1).length,
    );
    // Le logement a servi par ses trois voies : achats, baux, rénovations ; aucun bail n'a pris fin faute de loyer,
    // aucun bien n'est resté sans entretien payé (le rapprochement du logement des travailleurs le suppose), et
    // des travailleurs sont logés dans chaque cité.
    expect(housing.bought, 'biens achetés').toBeGreaterThan(0);
    expect(housing.leased, 'baux signés').toBeGreaterThan(0);
    expect(housing.renovated, 'biens rénovés').toBeGreaterThan(0);
    expect(lodging, 'hébergement chez les PNJ').toBeGreaterThan(0);
    const strained = await sql<{ n: string }>`select
      (select count(*) from game.leases where world_id = ${world.worldId} and end_reason = 'unpaid')
      + (select count(*) from game.properties where world_id = ${world.worldId} and upkeep_unpaid_since is not null) as n`.execute(
      world.db,
    );
    expect(Number(strained.rows[0]?.n), 'loyers ou entretiens impayés').toBe(0);
    const unhoused = await sql<{ employed: string; unhoused: string }>`
      select sum(employed) as employed, sum(unhoused) as unhoused from game.labor_market
      where world_id = ${world.worldId} and game_day = (select max(game_day) from game.labor_market where world_id = ${world.worldId})`.execute(
      world.db,
    );
    expect(Number(unhoused.rows[0]?.unhoused), 'travailleurs non logés').toBeLessThan(
      Number(unhoused.rows[0]?.employed),
    );
    // Les négociants ont transporté : leurs navires ont fait des voyages, arrivés avec leur cargaison.
    const sailed = (
      await sql<{ voyages: string; units: string }>`select count(*) as voyages,
        coalesce(sum(c.units), 0) as units
        from game.voyages v left join lateral (select sum(quantity) as units from game.voyage_cargo
          where voyage_id = v.id) c on true
        where v.world_id = ${world.worldId} and v.arrived_at is not null`.execute(world.db)
    ).rows[0];
    expect(Number(sailed?.voyages), 'voyages arrivés').toBeGreaterThan(0);
    expect(Number(sailed?.units), 'unités transportées').toBeGreaterThan(0);

    // Les flux mesurés (mise en route comprise), sommés sur tous les jours, rendent ceux du grand livre : le net de
    // chaque robinet et de chaque puits, relevé sur les lignes du grand livre, est l'opposé du solde de son compte,
    // que le rapprochement tire des flux comptés.
    const expectedNet = Object.fromEntries(
      Object.entries(ledger.expected)
        .filter(([key]) => key !== 'treasury')
        .map(([key, balance]) => [key, 0 - balance]),
    );
    expect(measured).toEqual(expectedNet);

    // Mesures publiées.
    const margins = recipeMargins(days.slice(-WINDOW), () => WAGES.workerOboles);
    await publish(days, margins, {
      minutes: Math.round(minutes * 10) / 10,
      stewards: stewards.length,
      stewardOperations: operations,
      voyages: Number(sailed?.voyages),
      units: Number(sailed?.units),
    });
  },
);

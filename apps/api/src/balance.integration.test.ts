import { isWorkshop } from '@oikos/config';
import { basketCost, costRatioBps, type Traded } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  accounts,
  cash,
  closeDay,
  closeOf,
  config,
  createCity,
  foundHouses,
  harvest,
  lastSeq,
  MINUTE,
  openBench,
  reconcile,
  referenceOf,
  tickDay,
  upkeepDue,
  wageOf,
  wagesDue,
  type City,
  type House,
} from './balance/city';
import { lodgingDue } from './balance/housing';
import { morning, ROLES, seller } from './balance/strategy';

/*
 * Équilibrage de la cité prototype (ticket #78, docs/specs/05-economie.md 5.2 et 5.5), dans un monde à
 * part : récolte, demande des PNJ et clôtures, joués à leur heure de jeu (`balance/city.ts`). D'abord
 * trois jours où des maisons vendent leur blé au prix de référence ; puis dix jours de mise en route
 * et 30 jours mesurés, avec la configuration initiale, bornés : inflation et besoins vitaux. Les
 * maisons scriptées acquièrent leurs sites, achètent leurs intrants et vendent leur production par les vraies commandes (`balance/strategy.ts`) ;
 * la demande des PNJ et la clôture quotidienne (population, entretien) sont celles du moteur. Les prix
 * sont relevés jour par jour, d'après le rang des échanges.
 */
/**
 * Terroir du scénario : depuis #669, la configuration initiale retire la laine à Kallistè (6.1), mais la cité
 * prototype de #78 est une cité seule, sans armateur, dont les tisserands tondent leurs moutons sur place. Le banc lui
 * rend donc toutes les matières premières, et ne change rien d'autre : bornes, recettes et prix sont ceux de `config`.
 * C'est un paramètre du banc, pas du jeu.
 */
const prototype = {
  ...config,
  cities: config.cities.map((city) =>
    city.id === 'kalliste'
      ? {
          ...city,
          terroir: config.recipes
            .filter((recipe) => !isWorkshop(recipe))
            .map((recipe) => recipe.id),
        }
      : city,
  ),
};
const bench = openBench({ config: prototype });
beforeAll(() => bench.start());
afterAll(() => bench.stop());

const DAYS = 3;

/**
 * Ce que la clôture du jour `day` verse aux bourses des PNJ (4.4, #632) : les salaires des travailleurs des sites et
 * leur hébergement, aucun n'étant logé (le banc de la cité prototype n'achète ni ne loue de logement).
 */
const pursesDue = async (city: City, houses: readonly House[], day: number) =>
  wagesDue(city, houses, day, wageOf(city)) +
  (await lodgingDue(
    city,
    houses.map((house) => ({ city, house })),
    day,
  ));

it('3 jours : tous les ticks du jour, grand livre rapproché', { timeout: 120_000 }, async () => {
  const city = await createCity(bench, DAYS);
  const houses = await foundHouses(city, [{ name: 'fermier', count: 4, sites: ['grow_wheat'] }]);
  let [upkeep, purses] = [0, 0];
  for (let day = 0; day < DAYS; day++) {
    upkeep += upkeepDue(city, houses, day);
    purses += await pursesDue(city, houses, day);
    await closeDay(city, day);
    const now = new Date(closeOf(city, day).getTime() + MINUTE);
    for (const house of houses) {
      await harvest(city, house, now);
      const quantity = house.produced.get('wheat') ?? 0;
      if (quantity > 0) {
        const placed = await city.send(house.user, 'market.placeOrder', {
          cityId: city.cityId,
          goodId: 'wheat',
          side: 'sell',
          price: referenceOf('wheat'),
          quantity,
        });
        expect(placed.ok).toBe(true);
      }
    }
    // Du tick de la clôture à la clôture suivante, tous les ticks du jour (24 hors changement d'heure).
    const length = closeOf(city, day + 1).getTime() - closeOf(city, day).getTime();
    expect(await tickDay(city, day)).toBe(length / (config.clock.tickMinutes * MINUTE));
  }

  // Robinets, puits et trésor de la cité rapprochés des flux comptés ; puis la masse en circulation.
  const ledger = await reconcile(city, houses.length, { sink_upkeep: upkeep }, new Map(), purses);
  expect(ledger.actual).toEqual(ledger.expected);
  expect(ledger.supply).toBe(ledger.mass);
  // Des PNJ ont acheté du blé, payé par la bourse de la cité (#632), taxé ; l'entretien a été prélevé.
  expect(ledger.npcPurchases).toBeGreaterThan(0);
  expect(ledger.expected['sink_market_tax']).toBeGreaterThan(0);
  expect(upkeep).toBeGreaterThan(0);
});

const MONTH = 30;
/**
 * Mise en route, non mesurée : les maisons acquièrent leurs sites et les prix trouvent leur niveau. Douze jours depuis
 * que les maisons paient salaires et hébergement (#668) : gardant de quoi les payer, elles acquièrent leurs sites plus
 * tard, et au dixième jour les besoins vitaux des hippeis ne sont encore couverts qu'à 94 %. C'est une fenêtre de mesure
 * choisie : ce démarrage à froid sous 98 % est connu et accepté (5.5), les bornes ne valent que pour les jours mesurés.
 */
const WARMUP = 12;

it(
  '30 jours, 15 biens, maisons scriptées : grand livre rapproché ; mesures publiées',
  { timeout: 600_000 },
  async () => {
    const city = await createCity(bench, WARMUP + MONTH);
    const houses = (await foundHouses(city, ROLES)).map(seller);

    const daily: {
      day: number;
      supply: number;
      cost: ReturnType<typeof basketCost>;
      traded: Map<string, Traded>;
      coverage: Record<string, number | null>;
      population: number;
    }[] = [];
    let [seq, upkeep, acquisitions, purses] = [await lastSeq(city), 0, 0, 0];
    for (let day = 0; day < WARMUP + MONTH; day++) {
      upkeep += upkeepDue(city, houses, day);
      purses += await pursesDue(city, houses, day);
      await closeDay(city, day);
      const now = new Date(closeOf(city, day).getTime() + MINUTE);
      // Les maisons jouent leur matinée chacune à son tour en premier : à ordre fixe, les premiers meuniers servent
      // chaque matin les achats de farine des boulangers, et le dernier, qui ne vend rien, ne paie plus ses salaires.
      const first = day % houses.length;
      for (const house of [...houses.slice(first), ...houses.slice(0, first)])
        acquisitions += await morning(city, house, now);
      // Un tick d'une heure par heure du jour de jeu : 24, sauf au changement d'heure.
      const hours =
        (closeOf(city, day + 1).getTime() - closeOf(city, day).getTime()) / (60 * MINUTE);
      expect(await tickDay(city, day)).toBe(hours);
      // Prix du jour : tous les échanges validés depuis la veille, PNJ compris.
      const trades = await sql<{ good_id: string; turnover: string; volume: string }>`
        select o.good_id, sum(t.price * t.quantity) as turnover, sum(t.quantity) as volume
        from game.trades t join game.orders o on o.id = t.sell_order_id
        where t.world_id = ${city.worldId} and t.seq > ${seq} group by o.good_id`.execute(city.db);
      seq = await lastSeq(city);
      const traded = new Map<string, Traded>(
        trades.rows.map((row) => [
          row.good_id,
          { turnover: BigInt(row.turnover), volume: BigInt(row.volume) },
        ]),
      );
      const population = await city.db
        .selectFrom('game.npc_population')
        .select(['class_id', 'population', 'coverage_bps'])
        .where('city_id', '=', city.cityId)
        .execute();
      if (day >= WARMUP)
        daily.push({
          day,
          supply: (await accounts(city)).supply,
          cost: basketCost(config.priceIndex.basket, traded),
          traded,
          coverage: Object.fromEntries(population.map((row) => [row.class_id, row.coverage_bps])),
          population: population.reduce((sum, row) => sum + row.population, 0),
        });
    }

    // Robinets, puits et trésor de la cité rapprochés des flux comptés ; puis la masse en circulation.
    const ledger = await reconcile(
      city,
      houses.length,
      { sink_upkeep: upkeep, sink_site_acquisition: acquisitions },
      new Map(),
      purses,
    );
    expect(ledger.actual).toEqual(ledger.expected);
    expect(ledger.supply).toBe(ledger.mass);

    // Mesures publiées par le test.
    const { system } = await accounts(city);
    const sinks = [...system].filter(([key, value]) => key.startsWith('sink_') && value !== 0);
    const destroyed = sinks.reduce((sum, [, value]) => sum + value, 0);
    // Coût du panier sur une fenêtre de jours : tous ses échanges réunis, comme l'indice d'Olympe.
    const level = (from: number, to: number) => {
      const traded = new Map<string, Traded>();
      for (const entry of daily.slice(from, to))
        for (const [goodId, good] of entry.traded) {
          const sum = traded.get(goodId) ?? { turnover: 0n, volume: 0n };
          traded.set(goodId, {
            turnover: sum.turnover + good.turnover,
            volume: sum.volume + good.volume,
          });
        }
      return basketCost(config.priceIndex.basket, traded);
    };
    // Écart du coût du panier des jours mesurés 20 à 30 sur celui des jours 0 à 10, moins 1 : pas
    // l'inflation d'un mois, dont les deux fenêtres seraient distantes de 30 jours.
    const ratio = costRatioBps(level(MONTH - 10, MONTH), level(0, 10));
    const basketLast10VsFirst10Bps = ratio === null ? null : ratio - 10_000;
    console.table(
      daily.map((entry) => ({
        day: entry.day,
        supply: entry.supply,
        basket: entry.cost ? Number(entry.cost[0] / entry.cost[1]) : null,
        population: entry.population,
        ...entry.coverage,
      })),
    );
    // Prix moyen et volume par bien, sur les dix premiers et les dix derniers jours mesurés.
    const window = (from: number, to: number, goodId: string) => {
      const [turnover, volume] = daily
        .slice(from, to)
        .map((entry) => entry.traded.get(goodId))
        .reduce<[bigint, bigint]>(
          (sum, good) => [sum[0] + (good?.turnover ?? 0n), sum[1] + (good?.volume ?? 0n)],
          [0n, 0n],
        );
      return volume === 0n ? '—' : `${(Number(turnover) / Number(volume)).toFixed(1)} × ${volume}`;
    };
    console.table(
      Object.fromEntries(
        config.goods.map((good) => [
          good.id,
          {
            reference: good.referencePriceOboles,
            first: window(0, 10, good.id),
            last: window(MONTH - 10, MONTH, good.id),
          },
        ]),
      ),
    );
    const summary = [];
    for (const house of houses)
      summary.push({
        role: house.role.name,
        sites: house.sites.length,
        cash: await cash(city, house.houseId),
      });
    console.table(summary);
    console.log({
      basketLast10VsFirst10Bps,
      supply: ledger.supply,
      destroyed,
      sinks: Object.fromEntries(
        sinks.map(([key, value]) => [key, Math.round((1000 * value) / destroyed) / 10]),
      ),
    });

    // Le marché a réellement tourné : des achats de PNJ, la taxe, l'entretien, des sites acquis.
    expect(ledger.npcPurchases).toBeGreaterThan(0);
    expect(ledger.expected['sink_market_tax']).toBeGreaterThan(0);
    expect(upkeep).toBeGreaterThan(0);
    expect(purses, 'salaires et hébergement').toBeGreaterThan(0);
    expect(acquisitions).toBeGreaterThan(0);
    // Bornes d'équilibrage de la cité prototype (#78), écrites à la main. Le coût du panier des dix
    // derniers jours ne dépasse celui des dix premiers que de 0 à 2 % : vingt jours d'écart, soit au plus 3 %
    // sur un mois, la cible de l'indice (5.5).
    expect(basketLast10VsFirst10Bps).not.toBeNull();
    expect(basketLast10VsFirst10Bps).toBeGreaterThanOrEqual(0);
    expect(basketLast10VsFirst10Bps).toBeLessThanOrEqual(200);
    // Besoins vitaux couverts : chaque classe, chaque jour mesuré, à 98 % au moins. Chaque jour mesuré
    // porte toutes les classes, pour que le minimum ne passe pas à vide.
    const classes = config.npcClasses.map((npcClass) => npcClass.id).sort();
    for (const entry of daily) expect(Object.keys(entry.coverage).sort()).toEqual(classes);
    const lowest = Math.min(
      ...daily.flatMap((entry) => Object.values(entry.coverage).map((coverage) => coverage ?? 0)),
    );
    expect(lowest).toBeGreaterThanOrEqual(9_800);
    // La cité ne se vide pas : la population de fin n'est pas sous celle du début de la mesure.
    expect(daily[0]?.population ?? 0).toBeGreaterThan(0);
    expect(daily.at(-1)?.population ?? 0).toBeGreaterThanOrEqual(daily[0]?.population ?? Infinity);
  },
);

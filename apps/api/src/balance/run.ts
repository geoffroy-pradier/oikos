import { tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import {
  closeDay,
  closeOf,
  config,
  createWorld,
  foundHouses,
  lastSeq,
  MINUTE,
  reconcile,
  tickDay,
  upkeepDue,
  wagesDue,
  stewardWageOf,
  wageOf,
  type Bench,
  type City,
} from './city';
import { housingMorning, lodgingDue, newHousing, propertyUpkeepDue } from './housing';
import { dateCitizens, dateMetics } from './calendar';
import { newPolitics, politicsMorning, settled } from './politics';
import { morning, seller, type Seller } from './strategy';
import { actAfterTick, hireSteward, type Steward } from './steward';
import {
  carrierMorning,
  carrierStep,
  newVoyageCosts,
  shipUpkeepDue,
  type Carrier,
} from './carrier';
import { planEvents } from './events';
import { measureDay, netInputs, npcDailyDemand, type DayMeasure } from './measures';
import {
  CARRIER,
  CARRIERS,
  MEASURED,
  SETTLEMENTS,
  SLUGS,
  WARMUP,
  WORLD_SEED,
  WORLD_STEPS,
  type Settlement,
} from './world';

/** Paramètres d'une partie du banc des quatre cités : les valeurs par défaut sont celles du banc de `ci`. */
export interface PlayOptions {
  /** Jours de mise en route, non mesurés. */
  warmup?: number;
  /** Jours mesurés. */
  measured?: number;
  /** Graine du monde : mêmes graine et configuration, même partie. */
  seed?: string;
}

/**
 * Joue un monde neuf des quatre cités (maisons scriptées par terroir, armateurs, intendants, logement, vie
 * civique) avec la configuration du banc, jour après jour, et rend tout ce que le banc de `ci` vérifie et que
 * le simulateur publie. Aucune vérification d'équilibrage ici : seules les gardes de la mécanique du banc lèvent.
 */
export async function playWorld(bench: Bench, options: PlayOptions = {}) {
  const warmup = options.warmup ?? WARMUP;
  const measuredDays = options.measured ?? MEASURED;
  const startedAt = Date.now();
  const cities = await createWorld(bench, warmup + measuredDays, SLUGS, options.seed ?? WORLD_SEED);
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
  // Armateurs : des maisons de leur cité d'attache, avec le site de départ de la cité ; chacun porte une part de la
  // demande de chaque bien vers chaque port, partagée entre tous ceux qui l'y portent.
  const carriers: Carrier[] = [];
  const carriedBy = new Map<string, number>();
  for (const spec of CARRIERS)
    for (const [slug, goods] of [
      [spec.home, spec.toHome],
      [spec.source, spec.toSource],
    ] as const)
      for (const goodId of goods)
        carriedBy.set(`${slug}/${goodId}`, (carriedBy.get(`${slug}/${goodId}`) ?? 0) + spec.count);
  for (const spec of CARRIERS) {
    const [home, source] = [spec.home, spec.source].map((slug) =>
      cities.find((city) => city.slug === slug),
    );
    if (!home || !source) throw new Error(`No city ${spec.home} or ${spec.source}`);
    const shares = (city: City, goods: readonly string[]) =>
      new Map(goods.map((goodId) => [goodId, 1 / (carriedBy.get(`${city.slug}/${goodId}`) ?? 1)]));
    for (const house of await foundHouses(home, [{ ...CARRIER, count: spec.count }]))
      carriers.push({
        ...seller(house),
        home,
        source,
        deliver: new Map([
          [home.cityId, shares(home, spec.toHome)],
          [source.cityId, shares(source, spec.toSource)],
        ]),
        waitedHours: 0,
        paid: newVoyageCosts(),
      });
  }
  // Demande d'un jour d'une cité : celle de ses PNJ, et les intrants que ses maisons scriptées ne produisent pas.
  const inputs = new Map(
    cities.map((city) => [
      city.cityId,
      netInputs(SETTLEMENTS[city.slug as (typeof SLUGS)[number]]),
    ]),
  );
  const demandOf = async (city: City) => {
    const demand = await npcDailyDemand(city);
    for (const [goodId, quantity] of inputs.get(city.cityId) ?? [])
      demand.set(goodId, (demand.get(goodId) ?? 0) + quantity);
    return demand;
  };
  const houses = [...settlements.flatMap((settlement) => settlement.houses), ...carriers];
  // Maisons et leur cité.
  const residents = [
    ...settlements.flatMap(({ city, houses: own }) => own.map((house) => ({ city, house }))),
    ...carriers.map((carrier) => ({ city: carrier.home, house: carrier as Seller })),
  ];
  const housing = newHousing();
  const politics = newPolitics();
  // Métèques arrivés au jour 0 de jeu : la clôture les promeut citoyens après `politics.meticDays` jours.
  for (const city of cities) await dateMetics(city, closeOf(city, 0));

  const days: DayMeasure[] = [];
  const measured: Record<string, number> = {};
  const stewards: Steward[] = [];
  const operations = { acted: 0, refused: 0, failed: 0 };
  let [seq, at, upkeep, acquisitions, ships] = [await lastSeq(world), new Date(0), 0, 0, 0];
  let [wages, estateUpkeep, lodging, shipUpkeep] = [0, 0, 0, 0];
  /** Événements du monde planifiés par le banc (7.4), par modèle. */
  const events: Record<string, number> = {};
  let measuredFrom = new Date(0);
  /** Monnaie en circulation à la fin de la mise en route, par cité et pour le monde : la base des jours mesurés. */
  let supplyBefore: Record<string, number> = {};
  for (let day = 0; day < warmup + measuredDays; day++) {
    upkeep += upkeepDue(world, houses, day);
    estateUpkeep += propertyUpkeepDue(world, housing, day);
    for (const carrier of carriers) shipUpkeep += shipUpkeepDue(carrier, closeOf(world, day));
    lodging += await lodgingDue(world, residents, day);
    // Salaires de la clôture : les travailleurs des sites, et les intendants embauchés avant elle (payés d'avance).
    for (const { city, house } of residents) wages += wagesDue(world, [house], day, wageOf(city));
    wages += stewards.filter((steward) => steward.hiredDay < day).length * stewardWageOf(world);
    await closeDay(world, day);
    // Événements que cette clôture aurait planifiés si elle était jouée à son heure (7.3).
    for (const event of await planEvents(world, cities, day))
      events[event.model] = (events[event.model] ?? 0) + 1;
    await dateCitizens(world, closeOf(world, day));
    const now = new Date(closeOf(world, day).getTime() + MINUTE);
    for (const { city, houses: own } of settlements)
      for (const house of own) acquisitions += await morning(city, house, now);
    for (const { city, houses: own } of settlements)
      for (const house of own) {
        const hired = await hireSteward(city, house, day, now, stewards);
        if (hired) stewards.push(hired);
      }
    // Logement : un armateur loue pour ses travailleurs, il n'achète pas ; sa trésorerie sert à ses cargaisons.
    for (const { city, house } of residents)
      await housingMorning(city, house, now, housing, !carriers.includes(house as Carrier));
    for (const { city, houses: own } of settlements)
      await politicsMorning(
        city,
        [...own, ...carriers.filter((carrier) => carrier.home.cityId === city.cityId)],
        now,
        politics,
      );
    for (const carrier of carriers) ships += await carrierMorning(carrier, now, demandOf);
    // Un tick d'une heure par heure du jour de jeu : 24, sauf au changement d'heure.
    const hours =
      (closeOf(world, day + 1).getTime() - closeOf(world, day).getTime()) / (60 * MINUTE);
    const ticks = await tickDay(world, day, WORLD_STEPS, async (index) => {
      const run = await actAfterTick(world, await bench.loader.at(), index);
      for (const key of ['acted', 'refused', 'failed'] as const) operations[key] += run[key];
      // Armateurs : un pas à mi-chemin du tick suivant.
      const at = new Date(tickStart(index, config.clock.tickMinutes).getTime() + 30 * MINUTE);
      for (const carrier of carriers) await carrierStep(carrier, at, demandOf);
    });
    if (ticks !== hours) throw new Error(`Day ${day}: ${ticks} ticks played, ${hours} expected`);
    // Mesures du jour ; la mise en route n'est pas publiée, mais le rang et l'instant avancent.
    const measure = await measureDay(settlements, day, { seq, at });
    [seq, at] = [
      await lastSeq(world),
      (await sql<{ now: Date }>`select clock_timestamp() as now`.execute(world.db)).rows[0]?.now ??
        at,
    ];
    for (const [key, net] of Object.entries(measure.flows['world'] ?? {}))
      measured[key] = (measured[key] ?? 0) + net;
    if (day >= warmup) days.push(measure);
    if (day === warmup - 1) [measuredFrom, supplyBefore] = [at, measure.supply];
  }

  // Décrets de dépense réglés par les clôtures jouées : leur montant sort du trésor de leur cité, vers son puits.
  const lastDay = warmup + measuredDays - 1;
  const paid = settled(world, politics, lastDay);
  const drawn = new Map<string, number>();
  for (const decree of paid)
    drawn.set(decree.cityId, (drawn.get(decree.cityId) ?? 0) + decree.amountOboles);
  // Coûts des voyages (4.6) : provisions et part détruite du droit de port, part versée au trésor d'arrivée.
  const voyages = newVoyageCosts();
  for (const { paid: costs } of carriers) {
    voyages.provisions += costs.provisions;
    voyages.portDuesBurned += costs.portDuesBurned;
    for (const [cityId, oboles] of costs.treasuries)
      voyages.treasuries.set(cityId, (voyages.treasuries.get(cityId) ?? 0) + oboles);
  }
  const paidFor = (model: string) =>
    paid
      .filter((decree) => decree.model === model)
      .reduce((sum, decree) => sum + decree.amountOboles, 0);

  // Robinets, puits et trésors des cités rapprochés des flux comptés ; puis la masse en circulation.
  const ledger = await reconcile(
    world,
    houses.length,
    {
      sink_upkeep: upkeep,
      sink_site_acquisition: acquisitions,
      sink_ship_purchase: ships,
      sink_ship_upkeep: shipUpkeep,
      sink_voyage_provisions: voyages.provisions,
      sink_port_dues: voyages.portDuesBurned,
      sink_property_purchase: housing.purchased,
      sink_property_works: housing.works,
      sink_property_upkeep: estateUpkeep,
      sink_public_works: paidFor('public_works'),
      sink_festivals: paidFor('festival'),
    },
    drawn,
    // Salaires (intendants compris) et hébergement vont aux bourses des PNJ (#632), sans rien détruire.
    wages + lodging,
    voyages.treasuries,
  );
  return {
    world,
    cities,
    settlements,
    houses,
    carriers,
    stewards,
    operations,
    housing,
    politics,
    days,
    /** Net de chaque robinet et de chaque puits du monde, mise en route comprise. */
    measured,
    ledger,
    paidFor,
    lastDay,
    measuredFrom,
    supplyBefore,
    acquisitions,
    wages,
    lodging,
    shipUpkeep,
    voyages,
    events,
    minutes: (Date.now() - startedAt) / 60_000,
  };
}
export type WorldRun = Awaited<ReturnType<typeof playWorld>>;
export type { City };

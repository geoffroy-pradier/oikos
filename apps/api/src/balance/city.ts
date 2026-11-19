import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  validateConfig,
  cityDailyWageOboles,
  cityStartingRecipeId,
  type GameConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import {
  CLOSE_STEPS,
  npcDemand,
  publicIncomeDue,
  runDailyClose,
  runTick,
  type TickStep,
} from '@oikos/engine';
import {
  accrueProduction,
  accrueWorkshop,
  dailyCloseAt,
  dailyUpkeep,
  gameDayAt,
  isDailyClose,
  lodgingPrice,
  marketTax,
  tickIndexAt,
  tickStart,
} from '@oikos/sim';
import { sql } from 'kysely';
import { createApp } from '../app';
import { unlimited } from '../rate-limit';
import { createTelemetry } from '../telemetry';
import { testVerifier } from '../test-config';
import { yieldOf } from './events';

/*
 * Banc d'équilibrage de la cité prototype (#78), au service de `balance.integration.test.ts` : un monde
 * à part, sa cité, ses maisons fondées par les vraies commandes ; demande des PNJ et clôtures du moteur.
 * L'horloge de la base ne s'avance pas : commandes et échanges sont datés de l'instant réel, et une
 * récolte par `site.collect` ne verrait pas passer les jours. La production est calculée à l'heure de jeu
 * par les fonctions pures de `site.collect`, puis écrite au journal des stocks ; ticks et clôtures sont
 * joués à leur instant de jeu.
 */
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Configuration jouée : la configuration initiale, ou la candidate du simulateur (#284) que
 * `BALANCE_CONFIG_FILE` désigne (le simulateur joue chaque partie dans son propre processus).
 */
const source: unknown = process.env['BALANCE_CONFIG_FILE']
  ? JSON.parse(readFileSync(process.env['BALANCE_CONFIG_FILE'], 'utf8'))
  : INITIAL_CONFIG;
const validation = validateConfig(source);
if (!validation.ok) throw new Error(validation.errors.join('\n'));
/**
 * La configuration, jouée en ticks d'une heure plutôt que de dix minutes pour garder le test
 * court : la demande de référence et le revenu des PNJ, donnés par tick, sont multipliés d'autant. La
 * demande et la dépense d'une journée, la production, l'entretien, la taxe et la population sont ceux
 * de la configuration telle quelle.
 */
const TICKS_MERGED = 60 / validation.config.clock.tickMinutes;
if (!Number.isInteger(TICKS_MERGED)) throw new Error('Ticks do not merge into one-hour ticks');
export const config = {
  ...validation.config,
  clock: { ...validation.config.clock, tickMinutes: 60 },
  npcClasses: validation.config.npcClasses.map((npcClass) => ({
    ...npcClass,
    incomePerThousand: npcClass.incomePerThousand * TICKS_MERGED,
    basket: npcClass.basket.map((need) => ({
      ...need,
      quantityPerThousand: need.quantityPerThousand * TICKS_MERGED,
    })),
  })),
};

export const MINUTE = 60_000;
export const recipeOf = (id: string) => {
  const recipe = config.recipes.find((candidate) => candidate.id === id);
  if (!recipe) throw new Error(`Unknown recipe ${id}`);
  return recipe;
};
export const referenceOf = (goodId: string) =>
  config.goods.find((good) => good.id === goodId)?.referencePriceOboles ?? 1;

/** Rôle d'une maison scriptée : nombre de maisons, portefeuille de sites dans l'ordre d'acquisition. */
export interface Role {
  name: string;
  count: number;
  sites: string[];
  trader?: true;
}
export interface Site {
  id: string;
  recipeId: string;
  /** Instant de jeu de sa création : l'entretien est dû à toute clôture qui le suit. */
  createdAt: Date;
  since: Date;
}
export interface House {
  role: Role;
  user: string;
  houseId: string;
  sites: Site[];
  /** Quantités de la dernière récolte, par bien : la production d'une journée. */
  produced: Map<string, number>;
}

// Les formes exactes sont vérifiées par les tests de chaque commande.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Reply = { ok: boolean; data?: any; error?: { code: string } };

/**
 * Connexions, application et configuration du banc ; `start` avant usage, `stop` à la fin. Le banc de
 * plusieurs cités joue une variante de `config` (`options.config`), qui ne change que des paramètres de
 * scénario (`world.ts`) : les recettes, l'horloge et les prix restent ceux de `config`.
 */
export function openBench(options: { config?: GameConfig } = {}) {
  const db = createDb(serviceRoleUrl(DATABASE_URL));
  const owner = createDb(DATABASE_URL);
  // Les clôtures et les ticks citent une version publiée ; ils lisent ici la configuration du banc,
  // accolée au `versionId` de la version en vigueur dans la base partagée : cet identifiant ne désigne
  // pas la configuration jouée.
  let loaded: LoadedConfig | undefined;
  const current = async () => {
    if (!loaded) throw new Error('Balance bench not started');
    return loaded;
  };
  const loader = { at: current, byId: current };
  const app = createApp({
    db,
    telemetry: createTelemetry(db),
    verifyToken: testVerifier,
    rateLimiter: unlimited,
    loadConfig: loader.at,
  });
  const send = async (user: string, command: string, body: unknown) => {
    const response = await app.request(`/api/commands/${command}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${user}`,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Reply;
  };
  return {
    db,
    owner,
    /** Configuration jouée. */
    played: options.config ?? config,
    loader,
    send,
    async start() {
      await ensureInitialConfig(db, INITIAL_CONFIG);
      loaded = {
        ...(await createConfigLoader(db).at(new Date())),
        config: options.config ?? config,
      };
    },
    stop: () => Promise.all([db.destroy(), owner.destroy()]),
  };
}
export type Bench = ReturnType<typeof openBench>;

export interface City extends Bench {
  worldId: string;
  cityId: string;
  /** Identifiant de la cité dans la configuration (`config.cities`). */
  slug: string;
  /** Jour de jeu du jour 0. */
  firstDay: number;
}

/** Graine de monde du banc à une cité (#78) ; celle du banc de plusieurs cités est dans `world.ts`. */
const SEED = 'banc-equilibrage-78';
/**
 * Un lundi du passé, fixé : le premier jour de tout monde du banc (#663). Il ne vient pas de l'heure réelle du
 * lancement, qui ferait jouer à deux parties de part et d'autre de la clôture des jours, donc des saisons et des
 * changements d'heure, différents. Il reste antérieur à l'instant de la base, qui refuse une clôture datée après lui.
 */
const FIRST_DAY_AT = new Date('2026-01-05T12:00:00Z');
/** Jour de jeu du jour 0 d'un monde du banc : celui de `FIRST_DAY_AT` dans l'horloge de la configuration. */
export const benchFirstDay = () => gameDayAt(FIRST_DAY_AT, config.clock);
/** Cités d'un monde neuf, une par identifiant de la configuration ; les `days` jours de jeu sont passés. */
export async function createWorld(
  bench: Bench,
  days: number,
  slugs: readonly string[],
  seed = SEED,
): Promise<City[]> {
  const firstDay = benchFirstDay();
  // La base refuse une clôture datée après son heure : le banc ne joue pas plus de jours que le passé n'en compte.
  if (dailyCloseAt(firstDay + days + 1, config.clock).getTime() > Date.now())
    throw new Error(`Bench of ${days} days does not end in the past`);
  const worldId = randomUUID();
  // Graine fixée (#267), pour que ses tirages soient reproductibles. Ses clôtures, celles de jours passés, ne
  // planifient aucun événement (7.3) : le banc des quatre cités les planifie lui-même (`balance/events.ts`), celui de
  // la cité prototype n'en joue aucun.
  await sql`insert into game.worlds (id, slug, name, seed)
    values (${worldId}, ${`b-${worldId.slice(0, 12)}`}, 'Équilibrage', ${seed})`.execute(
    bench.owner,
  );
  const cities: City[] = [];
  for (const slug of slugs) {
    const cityId = randomUUID();
    await sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, ${slug}, ${slug})`.execute(
      bench.owner,
    );
    cities.push({ ...bench, worldId, cityId, slug, firstDay });
  }
  return cities;
}
/** Monde et cité neufs (Kallistè) ; les `days` jours de jeu sont passés : la base refuse une clôture datée après son heure. */
export async function createCity(bench: Bench, days: number): Promise<City> {
  const [city] = await createWorld(bench, days, ['kalliste']);
  if (!city) throw new Error('No city created');
  return city;
}
export const closeOf = (city: City, day: number) => dailyCloseAt(city.firstDay + day, config.clock);

/** Maisons fondées par `house.create`, chacune avec le site de départ de sa cité, ramené au jour 0. */
export async function foundHouses(city: City, roles: readonly Role[]) {
  const [houses, day0]: [House[], Date] = [[], closeOf(city, 0)];
  for (const role of roles.flatMap((each) => Array<Role>(each.count).fill(each))) {
    const user = randomUUID();
    await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
      city.owner,
    );
    const founded = await city.send(user, 'house.create', {
      cityId: city.cityId,
      name: `Maison ${[...user.replace(/[^a-f]/g, '')].slice(0, 10).join('')}`,
      blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
    });
    if (!founded.ok) throw new Error(`house.create: ${founded.error?.code}`);
    const start = cityStartingRecipeId(config, city.slug);
    const field = await city.db
      .selectFrom('game.sites')
      .select('id')
      .where('house_id', '=', founded.data.houseId)
      .executeTakeFirstOrThrow();
    await backdate(city, field.id, day0);
    houses.push({
      role,
      user,
      houseId: founded.data.houseId,
      sites: [{ id: field.id, recipeId: start, createdAt: day0, since: day0 }],
      produced: new Map(),
    });
  }
  return houses;
}

export async function inventoryOf(city: City, houseId: string, goodId: string) {
  const found = await city.db
    .selectFrom('game.inventories')
    .select(['id', 'quantity', 'reserved'])
    .where('house_id', '=', houseId)
    .where('city_id', '=', city.cityId)
    .where('good_id', '=', goodId)
    .executeTakeFirst();
  if (found) return found;
  return city.db
    .insertInto('game.inventories')
    .values({ world_id: city.worldId, house_id: houseId, city_id: city.cityId, good_id: goodId })
    .returning(['id', 'quantity', 'reserved'])
    .executeTakeFirstOrThrow();
}
export async function free(city: City, houseId: string, goodId: string) {
  const inventory = await inventoryOf(city, houseId, goodId);
  return Number(inventory.quantity) - Number(inventory.reserved);
}
/** Mouvement de stock : de la production vers l'inventaire si `delta` > 0, l'inverse sinon. */
export async function move(city: City, houseId: string, goodId: string, delta: number) {
  const inventory = await inventoryOf(city, houseId, goodId);
  await city.db
    .insertInto('game.stock_ledger')
    .values({
      world_id: city.worldId,
      good_id: goodId,
      quantity: Math.abs(delta),
      kind: 'test.harvest',
      ...(delta > 0
        ? { from_system: 'production', to_inventory_id: inventory.id }
        : { from_inventory_id: inventory.id, to_system: 'production' }),
    })
    .execute();
}
/** Trésorerie de la maison, en oboles. */
export const cash = async (city: City, houseId: string) =>
  Number(
    (
      await city.db
        .selectFrom('game.accounts')
        .select('balance')
        .where('house_id', '=', houseId)
        .where('kind', '=', 'house')
        .executeTakeFirstOrThrow()
    ).balance,
  );
/**
 * Un site est daté par la base à l'instant réel de son acquisition ; il est ramené à son instant de
 * jeu, sinon aucune clôture passée ne lui demanderait d'entretien (garde levée le temps de l'écriture).
 */
export const backdate = (city: City, siteId: string, at: Date) =>
  city.owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = ${at}, cycle_started_at = ${at} where id = ${siteId}`.execute(
      trx,
    );
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });

/**
 * Récolte à l'heure de jeu `now`. Un site à l'arrêt (entretien impayé) fait échouer le banc : sa production
 * dépend de l'arrêt, que le banc ne simule pas, et le rapprochement suppose tout l'entretien dû payé.
 */
export async function harvest(city: City, house: House, now: Date) {
  house.produced.clear();
  const halted = await city.db
    .selectFrom('game.sites')
    .select('id')
    .where('house_id', '=', house.houseId)
    .where('halted_at', 'is not', null)
    .executeTakeFirst();
  if (halted)
    throw new Error(
      `Site ${halted.id} of ${house.role.name} is halted on ${now.toISOString()}: its upkeep was not paid`,
    );
  for (const site of house.sites) {
    const recipe = recipeOf(site.recipeId);
    const inputs = [];
    for (const stack of recipe.inputs)
      inputs.push({
        perCycle: stack.quantity,
        available: await free(city, house.houseId, stack.goodId),
      });
    const { cycles, since } =
      inputs.length === 0
        ? accrueProduction({
            since: site.since,
            now,
            cycleMinutes: recipe.durationMinutes,
            outputPerCycle: 1,
            maxCycles: recipe.maxAccruedCycles,
          })
        : accrueWorkshop({
            since: site.since,
            now,
            cycleMinutes: recipe.durationMinutes,
            maxCycles: recipe.maxAccruedCycles,
            inputs,
          });
    const started = site.since;
    site.since = since;
    if (cycles === 0) continue;
    for (const stack of recipe.inputs)
      await move(city, house.houseId, stack.goodId, -cycles * stack.quantity);
    for (const stack of recipe.outputs) {
      // Sécheresse et bonne année (7.4) : rendement cycle par cycle, comme `site.collect`.
      const quantity = await yieldOf(city, recipe.siteType, started, {
        cycleMinutes: recipe.durationMinutes,
        cycles,
        outputPerCycle: stack.quantity,
      });
      if (quantity > 0) await move(city, house.houseId, stack.goodId, quantity);
      house.produced.set(stack.goodId, (house.produced.get(stack.goodId) ?? 0) + quantity);
    }
  }
}

/** Revenu public des PNJ versé par les clôtures jouées, par monde (#632), compté par `closeDay`. */
const publicIncome = new Map<string, number>();
/**
 * Clôture quotidienne du moteur du jour `day`, jouée à son instant de jeu. Le banc compte ensuite le revenu public
 * qu'elle a versé (`publicIncomeDue`, le calcul du moteur), sur la population qu'elle vient de fixer et la
 * configuration jouée : le banc clôt chaque jour avant ses ticks, si bien que c'est elle qui le verse.
 */
export async function closeDay(city: City, day: number) {
  const closed = await runDailyClose(city.db, {
    worldId: city.worldId,
    gameDay: city.firstDay + day,
    closeAt: closeOf(city, day),
    config: city.loader,
    steps: CLOSE_STEPS,
    now: new Date(closeOf(city, day).getTime() + 1000),
  });
  const due = (await publicIncomeDue(city.db, city.worldId, city.played)).reduce(
    (sum, row) => sum + row.oboles,
    0,
  );
  publicIncome.set(city.worldId, (publicIncome.get(city.worldId) ?? 0) + due);
  return closed;
}
/**
 * Ticks de demande des PNJ du jour `day`, à leur instant de jeu, du premier qui commence à sa clôture ou
 * juste après (il ouvre le jour pour le moteur : `isDailyClose`) à la clôture suivante ; rend leur nombre.
 */
export async function tickDay(
  city: City,
  day: number,
  steps: readonly TickStep[] = [npcDemand],
  after?: (index: number) => Promise<void>,
) {
  const { tickMinutes } = config.clock;
  const end = closeOf(city, day + 1);
  const first = tickIndexAt(new Date(closeOf(city, day).getTime() - 1), tickMinutes) + 1;
  if (!isDailyClose(first, config.clock)) throw new Error(`Tick ${first} does not open day ${day}`);
  for (let index = first; ; index++) {
    const scheduledAt = tickStart(index, tickMinutes);
    if (scheduledAt >= end) return index - first;
    await runTick(city.db, {
      worldId: city.worldId,
      index,
      scheduledAt,
      config: city.loader,
      steps,
      now: () => new Date(scheduledAt.getTime() + 1000),
    });
    await after?.(index);
  }
}
/** Entretien dû à la clôture du jour `day`, d'après les sites du banc créés avant elle. */
export const upkeepDue = (city: City, houses: readonly House[], day: number) =>
  houses
    .flatMap((house) => house.sites)
    .filter((site) => site.createdAt < closeOf(city, day))
    .reduce((sum, site) => {
      const { coefficientBps, dailyOboles } = config.sites.upkeep;
      return sum + dailyUpkeep(dailyOboles[recipeOf(site.recipeId).siteType], coefficientBps);
    }, 0);
/** Salaires dus à la clôture du jour `day`, d'après les sites du banc créés avant elle : `wage` oboles par travailleur. */
export const wagesDue = (city: City, houses: readonly House[], day: number, wage: number) =>
  houses
    .flatMap((house) => house.sites)
    .filter((site) => site.createdAt < closeOf(city, day))
    .reduce((sum, site) => sum + recipeOf(site.recipeId).workers * wage, 0);
/**
 * Monnaie en circulation (`supply`, comptes hors système) ; soldes des comptes système, du trésor et des bourses
 * des PNJ (`npc_purse`, #632, lues par la fonction de la base : le service ne les voit pas dans la table).
 */
export async function accounts(city: City) {
  const rows = await city.db
    .selectFrom('game.accounts')
    .select(['kind', 'system_key', 'balance'])
    .where('world_id', '=', city.worldId)
    .where('npc_purse', '=', false)
    .execute();
  const purses = await sql<{ balance: string }>`select balance from game.npc_purses()
    where world_id = ${city.worldId}`.execute(city.db);
  const system = new Map<string, number>();
  let supply = 0;
  for (const { balance } of purses.rows) {
    supply += Number(balance);
    system.set('npc_purse', (system.get('npc_purse') ?? 0) + Number(balance));
  }
  for (const row of rows) {
    if (row.kind !== 'system') supply += Number(row.balance);
    // Les trésors de plusieurs cités sont une même ligne : leur somme.
    if (row.kind === 'system' || row.kind === 'treasury')
      system.set(
        row.system_key ?? row.kind,
        (system.get(row.system_key ?? row.kind) ?? 0) + Number(row.balance),
      );
  }
  return { supply, system };
}
const nonZero = (balances: Record<string, number>) =>
  Object.fromEntries(Object.entries(balances).filter(([, value]) => value !== 0));
/**
 * Grand livre rapproché de flux comptés sans relire aucun solde : dotation des `founded` maisons, revenu public
 * des PNJ compté à chaque clôture (`closeDay`, #632), achats des PNJ (échanges sans ordre d'achat, payés par les
 * bourses des PNJ), taxe recalculée échange par échange par `marketTax` (règle des
 * commandes et du moteur), autres puits comptés par le banc (`counted`), dépenses de décrets tirées des trésors
 * (`drawn`, par cité), ce que les maisons ont versé aux bourses des PNJ (`purses` : salaires et hébergement, #632),
 * qui reste en circulation, et la part du droit de port versée aux trésors (`dues`, par cité). Rend les soldes non nuls des
 * comptes système et du trésor (`actual`), ce que les flux font attendre (`expected`), la monnaie en
 * circulation et la masse attendue : dotation et revenu public, moins tous les puits ; `npcPurchases` : le brut des
 * achats des PNJ.
 */
export async function reconcile(
  city: City,
  founded: number,
  counted: Record<string, number>,
  drawn: ReadonlyMap<string, number> = new Map(),
  purses = 0,
  dues: ReadonlyMap<string, number> = new Map(),
) {
  const trades = await city.db
    .selectFrom('game.trades as t')
    .innerJoin('game.orders as o', 'o.id', 't.sell_order_id')
    .select(['t.price', 't.quantity', 't.buy_order_id', 'o.city_id'])
    .where('t.world_id', '=', city.worldId)
    .execute();
  // Trésor de chaque cité : la part de la taxe des échanges de son marché.
  const treasuries = new Map<string, number>();
  const grant = founded * city.played.starting.grantOboles;
  const flows = { sink_market_tax: 0, treasury: 0 };
  let npcPurchases = 0;
  for (const trade of trades) {
    const gross = Number(trade.price) * Number(trade.quantity);
    const tax = marketTax(gross, config.marketTax);
    if (trade.buy_order_id === null) npcPurchases += gross;
    flows.sink_market_tax += tax.burned;
    flows.treasury += tax.treasury;
    treasuries.set(trade.city_id, (treasuries.get(trade.city_id) ?? 0) + tax.treasury);
  }
  // Dépenses des décrets (6.3), comptées par le banc : elles sortent du trésor de leur cité, vers leur puits (`counted`).
  for (const [cityId, amount] of drawn) {
    treasuries.set(cityId, (treasuries.get(cityId) ?? 0) - amount);
    flows.treasury -= amount;
  }
  // Droit de port (4.6, 5.6) : la part qui n'est pas détruite va au trésor de la cité d'arrivée.
  for (const [cityId, amount] of dues) {
    treasuries.set(cityId, (treasuries.get(cityId) ?? 0) + amount);
    flows.treasury += amount;
  }
  const { supply, system } = await accounts(city);
  const income = publicIncome.get(city.worldId) ?? 0;
  const sinks = Object.values(counted).reduce((sum, sink) => sum + sink, flows.sink_market_tax);
  return {
    actual: nonZero(Object.fromEntries(system)),
    expected: nonZero({
      faucet_starting_grant: -grant,
      faucet_npc_public_income: -income,
      ...counted,
      ...flows,
      npc_purse: purses + income - npcPurchases,
    }),
    supply,
    mass: grant + income - sinks,
    npcPurchases,
    /** Trésor attendu de chaque cité (par identifiant) : le banc en compare les soldes à `treasuryOf`. */
    treasuries,
  };
}
/** Rang du dernier échange du monde. */
export const lastSeq = async (city: City) =>
  Number(
    (
      await sql<{
        seq: string | null;
      }>`select max(seq) as seq from game.trades where world_id = ${city.worldId}`.execute(city.db)
    ).rows[0]?.seq ?? 0,
  );
/** Solde du trésor de chaque cité du monde, par identifiant de cité. */
export async function treasuryOf(city: City) {
  const rows = await city.db
    .selectFrom('game.accounts')
    .select(['city_id', 'balance'])
    .where('world_id', '=', city.worldId)
    .where('kind', '=', 'treasury')
    .where('npc_purse', '=', false)
    .execute();
  return new Map(rows.map((row) => [row.city_id ?? '', Number(row.balance)]));
}

/** Prix d'une nuit chez les PNJ dans la cité, tel que la dernière clôture l'a fixé (public, 4.4) ; 0 avant la première. */
export async function lodgingOf(city: City) {
  const row = await city.db
    .selectFrom('game.labor_market')
    .select('lodging_oboles')
    .where('city_id', '=', city.cityId)
    .orderBy('game_day', 'desc')
    .limit(1)
    .executeTakeFirst();
  return Number(row?.lodging_oboles ?? 0);
}
/**
 * Salaire du jour d'un travailleur de la cité, d'après la configuration jouée (4.4). Le banc ne joue que la courbe
 * neutre du salaire (`labor.wage`), qui laisse ce salaire de base tel quel : il refuse une autre courbe plutôt que de
 * mal compter les salaires.
 */
export function wageOf(city: City) {
  const { minBps, maxBps } = city.played.labor.wage;
  if (minBps !== 10_000 || maxBps !== 10_000)
    throw new Error('The bench plays a neutral wage curve');
  return cityDailyWageOboles(city.played, city.slug);
}
/** Salaire du jour d'un intendant, d'après la configuration jouée (4.4, #278). */
export const stewardWageOf = (city: City) => city.played.stewards?.dailyWageOboles ?? 0;
/** Prix d'une nuit chez les PNJ au pire (tous les travailleurs de la cité sans logement), d'après la configuration jouée. */
export const worstLodging = (city: City) =>
  lodgingPrice({
    baseOboles: city.played.labor.lodging.baseOboles,
    workers: 1,
    unhoused: 1,
    curve: city.played.labor.lodging,
  });

import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  validateConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { CLOSE_STEPS, npcDemand, runDailyClose, runTick } from '@oikos/engine';
import {
  accrueProduction,
  accrueWorkshop,
  dailyCloseAt,
  dailyUpkeep,
  gameDayAt,
  isDailyClose,
  marketTax,
  tickIndexAt,
  tickStart,
} from '@oikos/sim';
import { sql } from 'kysely';
import { createApp } from '../app';
import { unlimited } from '../rate-limit';
import { createTelemetry } from '../telemetry';
import { testVerifier } from '../test-config';

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

const validation = validateConfig(INITIAL_CONFIG);
if (!validation.ok) throw new Error(validation.errors.join('\n'));
/**
 * La configuration initiale, jouée en ticks d'une heure plutôt que de dix minutes pour garder le test
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

/** Connexions, application et configuration du banc ; `start` avant usage, `stop` à la fin. */
export function openBench() {
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
    loader,
    send,
    async start() {
      await ensureInitialConfig(db, INITIAL_CONFIG);
      loaded = { ...(await createConfigLoader(db).at(new Date())), config };
    },
    stop: () => Promise.all([db.destroy(), owner.destroy()]),
  };
}
export type Bench = ReturnType<typeof openBench>;

export interface City extends Bench {
  worldId: string;
  cityId: string;
  /** Jour de jeu du jour 0. */
  firstDay: number;
}

/** Monde et cité neufs ; les `days` jours de jeu sont passés : la base refuse une clôture datée après son heure. */
export async function createCity(bench: Bench, days: number): Promise<City> {
  const [worldId, cityId] = [randomUUID(), randomUUID()];
  await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`b-${worldId.slice(0, 12)}`}, 'Équilibrage')`.execute(
    bench.owner,
  );
  await sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Kallistè')`.execute(
    bench.owner,
  );
  return { ...bench, worldId, cityId, firstDay: gameDayAt(new Date(), config.clock) - days - 2 };
}
export const closeOf = (city: City, day: number) => dailyCloseAt(city.firstDay + day, config.clock);

/** Maisons fondées par `house.create`, chacune avec le champ de blé de la fondation, ramené au jour 0. */
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
      sites: [{ id: field.id, recipeId: 'grow_wheat', createdAt: day0, since: day0 }],
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
    site.since = since;
    if (cycles === 0) continue;
    for (const stack of recipe.inputs)
      await move(city, house.houseId, stack.goodId, -cycles * stack.quantity);
    for (const stack of recipe.outputs) {
      await move(city, house.houseId, stack.goodId, cycles * stack.quantity);
      house.produced.set(
        stack.goodId,
        (house.produced.get(stack.goodId) ?? 0) + cycles * stack.quantity,
      );
    }
  }
}

/** Clôture quotidienne du moteur, jouée à son instant de jeu. */
export const closeDay = (city: City, day: number) =>
  runDailyClose(city.db, {
    worldId: city.worldId,
    gameDay: city.firstDay + day,
    closeAt: closeOf(city, day),
    config: city.loader,
    steps: CLOSE_STEPS,
    now: new Date(closeOf(city, day).getTime() + 1000),
  });
/**
 * Ticks de demande des PNJ du jour `day`, à leur instant de jeu, du premier qui commence à sa clôture ou
 * juste après (il ouvre le jour pour le moteur : `isDailyClose`) à la clôture suivante ; rend leur nombre.
 */
export async function tickDay(city: City, day: number) {
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
      steps: [npcDemand],
      now: () => new Date(scheduledAt.getTime() + 1000),
    });
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
/** Monnaie en circulation (`supply`, comptes hors système) ; soldes des comptes système et du trésor. */
export async function accounts(city: City) {
  const rows = await city.db
    .selectFrom('game.accounts')
    .select(['kind', 'system_key', 'balance'])
    .where('world_id', '=', city.worldId)
    .execute();
  const system = new Map<string, number>();
  let supply = 0;
  for (const row of rows) {
    if (row.kind !== 'system') supply += Number(row.balance);
    if (row.kind === 'system' || row.kind === 'treasury')
      system.set(row.system_key ?? row.kind, Number(row.balance));
  }
  return { supply, system };
}
const nonZero = (balances: Record<string, number>) =>
  Object.fromEntries(Object.entries(balances).filter(([, value]) => value !== 0));
/**
 * Grand livre rapproché de flux comptés sans relire aucun solde : dotation des `founded` maisons, achats
 * des PNJ (échanges sans ordre d'achat), taxe recalculée échange par échange par `marketTax` (règle des
 * commandes et du moteur), autres puits comptés par le banc (`counted`). Rend les soldes non nuls des
 * comptes système et du trésor (`actual`), ce que les flux font attendre (`expected`), la monnaie en
 * circulation et la masse attendue : dotation et achats des PNJ, moins tous les puits.
 */
export async function reconcile(city: City, founded: number, counted: Record<string, number>) {
  const trades = await city.db
    .selectFrom('game.trades')
    .select(['price', 'quantity', 'buy_order_id'])
    .where('world_id', '=', city.worldId)
    .execute();
  const grant = founded * config.starting.grantOboles;
  const flows = { faucet_npc_purchases: 0, sink_market_tax: 0, treasury: 0 };
  for (const trade of trades) {
    const gross = Number(trade.price) * Number(trade.quantity);
    const tax = marketTax(gross, config.marketTax);
    if (trade.buy_order_id === null) flows.faucet_npc_purchases -= gross;
    flows.sink_market_tax += tax.burned;
    flows.treasury += tax.treasury;
  }
  const { supply, system } = await accounts(city);
  const sinks = Object.values(counted).reduce((sum, sink) => sum + sink, flows.sink_market_tax);
  return {
    actual: nonZero(Object.fromEntries(system)),
    expected: nonZero({ faucet_starting_grant: -grant, ...counted, ...flows }),
    supply,
    mass: grant - flows.faucet_npc_purchases - sinks,
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

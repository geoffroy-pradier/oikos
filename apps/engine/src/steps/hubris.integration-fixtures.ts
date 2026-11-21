import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
  type HubrisRules,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt, HUBRIS_CAUSES } from '@oikos/sim';
import { sql, type RawBuilder } from 'kysely';
import { afterAll, beforeAll } from 'vitest';
import { runDailyClose, type CloseStep } from '../close';
import { hubrisGauge } from './hubris-gauge';

// Jeu d'essai de la jauge d'Hybris (#734), contre Supabase local : chaque test a son monde et joue des clôtures passées.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const db = createDb(serviceRoleUrl(DATABASE_URL));
export const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
export const at = (day: number) => dailyCloseAt(day, clock);
export const hour = 3_600_000;
export const DAY = gameDayAt(new Date(), clock) - 10;
export const NEUTRAL = initial.hubris as HubrisRules;
export const WEIGHTED: HubrisRules = {
  ...NEUTRAL,
  marketShareWeight: 10_000,
  wealthWeight: 10_000,
  leviedLiturgyWeight: 500,
  offeringReliefBps: 1_000,
  performedLiturgyRelief: 40,
  dailyDecay: 10,
};
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
export const close = (
  worldId: string,
  gameDay: number,
  hubris: HubrisRules | null = WEIGHTED,
  steps: readonly CloseStep[] = [hubrisGauge],
) =>
  runDailyClose(db, {
    worldId,
    gameDay,
    closeAt: at(gameDay),
    config: {
      at: async () => {
        const config: GameConfig = { ...initial, clock };
        if (hubris) config.hubris = hubris;
        else delete config.hubris;
        return { ...loaded, config };
      },
    },
    steps,
    now: new Date(),
  });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

export type World = { worldId: string; city: string; ids: string[] };
/** Exécute des instructions dans l'ordre, dans une transaction du propriétaire. */
const ownerRun = (build: (trx: typeof owner) => Promise<RawBuilder<unknown>[]>) =>
  owner.transaction().execute(async (trx) => {
    for (const statement of await build(trx)) await statement.execute(trx);
  });

/**
 * Un monde à une cité, des maisons de joueur dotées par le robinet de départ, puis des maisons PNJ de secours (sans
 * compte de joueur), toutes de la cité, chacune avec un stock de blé vide. Identifiants dans l'ordre donné.
 */
export async function newWorld(players: number[], npcs: number[] = []): Promise<World> {
  const [worldId, city] = [randomUUID(), randomUUID()];
  const ids = [...players, ...npcs].map(() => randomUUID());
  const users = ids.map((_, index) => (index < players.length ? randomUUID() : null));
  const grants = [...players, ...npcs];
  await ownerRun(async () => [
    sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`h-${worldId.slice(0, 12)}`}, 'Test')`,
    sql`insert into game.cities (id, world_id, slug, name) values (${city}, ${worldId}, 'c0', 'Cité')`,
    sql`insert into auth.users (id, email) select u, u || '@example.test' from unnest(${users}::uuid[]) u where u is not null`,
    sql`insert into game.houses (id, world_id, user_id, name, blazon, kind)
      select h, ${worldId}, u, 'Maison ' || chr(96 + n::int), '{}', case when u is null then 'npc' else 'player' end
      from unnest(${ids}::uuid[], ${users}::uuid[]) with ordinality v (h, u, n)`,
    sql`insert into game.citizenships (house_id, city_id) select h, ${city} from unnest(${ids}::uuid[]) h`,
    sql`insert into game.accounts (world_id, kind, house_id) select ${worldId}, 'house', h from unnest(${ids}::uuid[]) h`,
    sql`insert into game.inventories (world_id, house_id, city_id, good_id)
      select ${worldId}, h, ${city}, 'wheat' from unnest(${ids}::uuid[]) h`,
    ...ids.map((id, index) =>
      post(worldId, 'house.starting_grant', 'faucet_starting_grant', id, grants[index] ?? 0),
    ),
  ]);
  return { worldId, city, ids };
}

/** Écriture équilibrée de `amount` oboles entre un compte système et la trésorerie d'une maison (positif : vers elle). */
const post = (worldId: string, kind: string, system: string, houseId: string, amount: number) =>
  sql<{ id: string }>`with e as (insert into game.ledger_entries (world_id, kind, meta)
      select ${worldId}, ${kind}, jsonb_build_object('houseId', ${houseId}::text) where ${amount}::bigint <> 0 returning id),
    l as (insert into game.ledger_lines (entry_id, account_id, amount)
      select e.id, a.id, case when a.kind = 'house' then 1 else -1 end * ${amount}::bigint from e, game.accounts a
      where a.world_id = ${worldId} and (a.house_id = ${houseId} and a.kind = 'house' or a.system_key = ${system}))
    select id from e`;
const entryOf = async (trx: typeof owner, ...args: Parameters<typeof post>) =>
  (await post(...args).execute(trx)).rows[0]?.id ?? null;

/** Ventes de blé à une obole l'unité, achetées par les PNJ, chacune `[maison, quantité, instant]`. */
export const sales = ({ worldId, city }: World, list: [string, number, Date][]) =>
  ownerRun(async (trx) => {
    for (const [houseId, quantity, when] of list) {
      await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
        select ${worldId}, 'wheat', ${quantity}, 'production', id, 'test.seed' from game.inventories
        where house_id = ${houseId}`.execute(trx);
      const entry = await entryOf(
        trx,
        worldId,
        'npc.purchase',
        'faucet_npc_purchases',
        houseId,
        quantity,
      );
      await sql`with o as (insert into game.orders (world_id, house_id, city_id, good_id, side, price, quantity, remaining)
          values (${worldId}, ${houseId}, ${city}, 'wheat', 'sell', 1, ${quantity}, ${quantity}) returning id)
        insert into game.trades (world_id, sell_order_id, price, quantity, ledger_entry_id, created_at)
        select ${worldId}, o.id, 1, ${quantity}, ${entry}, ${when} from o`.execute(trx);
    }
    return [];
  });

export type Act =
  | { offering: number; when: Date }
  | { performed: number; splendor: number; when: Date }
  | { leviedDay: number };
/**
 * Actes d'une maison, datés dans le passé : offrandes de monnaie, liturgies accomplies (avec faste), ou prélevées à la
 * clôture d'un jour. Les oboles passent par le grand livre ; offrandes et liturgies sont posées par le propriétaire,
 * gardes levées pour cette seule transaction, faute de pouvoir les dater autrement que de maintenant.
 */
export const acts = ({ worldId, city }: World, houseId: string, list: Act[]) =>
  ownerRun(async (trx) => {
    for (const act of list) {
      const [kind, sink, paid] =
        'offering' in act
          ? ['temple.offering', 'sink_offerings', act.offering]
          : 'performed' in act
            ? ['liturgy.perform', 'sink_liturgies', act.performed + act.splendor]
            : ['liturgy.levy', 'sink_liturgies', 0];
      const entry = await entryOf(trx, worldId, kind, sink, houseId, -paid);
      await sql`set local session_replication_role = replica`.execute(trx);
      if ('offering' in act)
        await sql`insert into game.offerings (world_id, house_id, city_id, god_id, oboles, charis, ledger_entry_id, created_at)
          values (${worldId}, ${houseId}, ${city}, 'apollo', ${paid}, ${paid}, ${entry}, ${act.when})`.execute(
          trx,
        );
      else {
        const day = 'leviedDay' in act ? act.leviedDay : gameDayAt(act.when, clock);
        const due = 'performed' in act ? act.performed : 100;
        await sql`insert into game.liturgies (world_id, city_id, house_id, season, genre, due, designated_day, due_day,
            due_at, status, splendor, paid, settled_day, settled_at, ledger_entry_id)
          values (${worldId}, ${city}, ${houseId}, ${list.indexOf(act)}, 'festival', ${due}, ${day - 3}, ${day}, ${at(day)},
            ${paid > 0 ? 'performed' : 'levied'}, ${paid - Math.min(paid, due)}, ${paid}, ${day},
            ${'when' in act ? act.when : at(day)}, ${entry})`.execute(trx);
      }
      await sql`set local session_replication_role = origin`.execute(trx);
    }
    return [];
  });

/** Lignes du journal de l'Hybris : `maison:cause:variation@jour`, dans l'ordre où elles s'appliquent. */
export const linesOf = async ({ worldId, ids }: World) =>
  (
    await sql<{
      line: string;
    }>`select array_position(${ids}::uuid[], house_id) - 1 || ':' || cause || ':' || amount
        || '@' || (game_day - ${DAY}) as line
      from game.hubris_ledger where world_id = ${worldId}
      order by game_day, array_position(${ids}::uuid[], house_id), array_position(${[...HUBRIS_CAUSES]}::text[], cause)`.execute(
      db,
    )
  ).rows.map((row) => row.line);
export const gaugesOf = async ({ worldId, ids }: World) =>
  (
    await sql<{
      gauges: Record<string, number> | null;
    }>`select jsonb_object_agg(array_position(${ids}::uuid[], house_id) - 1, gauge)
      as gauges from game.hubris where world_id = ${worldId}`.execute(db)
  ).rows[0]?.gauges;

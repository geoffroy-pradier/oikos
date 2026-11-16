import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWorld } from '../scheduler';
import { decreeApplication } from './decree-application';
import { decreeSpending } from './decree-spending';
import { decreeTally } from './decree-tally';

// Règlement des décrets de dépense à la clôture (#263), contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
const initial = INITIAL_CONFIG as GameConfig;
if (!initial.decrees) throw new Error('decrees expected in the initial config');
// Plafond d'un décret : 25 % du trésor.
const config: GameConfig = {
  ...initial,
  clock,
  decrees: { ...initial.decrees, spendingCapShareBps: 2_500 },
};
let active: LoadedConfig;
const loads = (given: GameConfig = config) => ({
  at: async () => ({ ...active, config: given }),
  byId: createConfigLoader(db).byId,
});
const TODAY = gameDayAt(new Date(), clock);
const closeAt = dailyCloseAt(TODAY, clock);
const close = (worldId: string, given?: GameConfig) =>
  closeWorld(db, { worldId, now: closeAt, config: loads(given), steps: [decreeSpending] });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  active = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Un monde, Kallistè, son archonte, et un trésor de `treasury` oboles venu du robinet ; garde levée. */
async function newWorld(treasury: number) {
  const [worldId, cityId, houseId, userId, officeId] = [1, 2, 3, 4, 5].map(() => randomUUID());
  const guards = (on: boolean) =>
    ['elections', 'offices', 'decrees'].map(
      (name) => sql`alter table ${sql.table(`game.${name}`)} ${sql.raw(on ? 'enable' : 'disable')}
        trigger ${sql.ref(`${name}_guard`)}`,
    );
  const run = (queries: ReturnType<typeof sql>[]) =>
    owner.transaction().execute(async (trx) => {
      for (const query of queries) await query.execute(trx);
    });
  await run([
    sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`s-${worldId?.slice(0, 12)}`}, 'Test')`,
    sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'K')`,
    sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`,
    sql`insert into game.houses (id, world_id, user_id, name, blazon)
      values (${houseId}, ${worldId}, ${userId}, ${`Maison ${houseId?.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}')`,
    sql`insert into game.accounts (world_id, kind, house_id) values (${worldId}, 'house', ${houseId})`,
    ...[treasury]
      .filter((amount) => amount > 0)
      .map(
        (
          amount,
        ) => sql`with e as (insert into game.ledger_entries (world_id, kind) values (${worldId}, 'test.seed') returning id)
      insert into game.ledger_lines (entry_id, account_id, amount)
      select e.id, a.id, case when a.kind = 'treasury' then ${amount}::bigint else -${amount}::bigint end
      from e, game.accounts a where a.world_id = ${worldId}
        and (a.kind = 'treasury' or a.system_key = 'faucet_npc_purchases')`,
      ),
    ...guards(false),
    sql`with e as (insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at,
        voting_closes_at, term_ends_at, tallied_at) values (${worldId}, ${cityId}, 'archon', now() - interval '9 days',
        now() - interval '8 days', now() - interval '7 days', now() + interval '20 days', now()) returning *)
      insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
      select ${officeId}, world_id, city_id, office, ${houseId}, id, voting_closes_at, term_ends_at from e`,
    ...guards(true),
  ]);
  /** Un décret adopté ; `rank` ordonne la fin des votes (le plus petit d'abord). */
  const decree = async (model: string, params: object, rank: number) => {
    const decreeId = randomUUID();
    await run([
      ...guards(false),
      sql`insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at,
          voting_closes_at, quorum_bps, status, tallied_at, electorate, votes_for, votes_against)
        values (${decreeId}, ${worldId}, ${cityId}, ${model}, ${JSON.stringify(params)}::jsonb, ${officeId}, ${houseId},
          now() - interval '9 days', ${closeAt}::timestamptz - make_interval(mins => ${100 - rank}), 0, 'adopted', now(), 1, 1, 0)`,
      ...guards(true),
    ]);
    return decreeId;
  };
  return { worldId: worldId ?? '', cityId: cityId ?? '', houseId: houseId ?? '', decree };
}
/** État de chaque décret : `état:jour du règlement:appliqué maintenant`. */
const statesOf = async (ids: string[]) =>
  Promise.all(
    ids.map(async (id) => {
      const row = await db
        .selectFrom('game.decrees')
        .select(['status', 'settled_day', 'applied_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return `${row.status}:${row.settled_day === TODAY ? 'today' : row.settled_day}:${row.applied_at !== null}`;
    }),
  );
const balancesOf = async (worldId: string) =>
  Object.fromEntries(
    (
      await db
        .selectFrom('game.accounts')
        .select(['kind', 'system_key', 'balance'])
        .where('world_id', '=', worldId)
        .where((eb) =>
          eb.or([
            eb('kind', '=', 'treasury'),
            eb('system_key', 'in', ['sink_public_works', 'sink_festivals']),
          ]),
        )
        .execute()
    ).map((row) => [row.system_key ?? row.kind, Number(row.balance)]),
  );
const eventsOf = async (ids: string[]) =>
  (
    await sql<{
      type: string;
      payload: Record<string, unknown>;
    }>`select type, payload from game.domain_events
      where type in ('DecreeApplied', 'DecreeLapsed') and payload->>'decreeId' = any(${ids}) order by seq`.execute(
      db,
    )
  ).rows.map((row) => ({
    type: row.type,
    decreeId: row.payload['decreeId'],
    ...(row.payload['spentOboles'] === undefined ? {} : { spent: row.payload['spentOboles'] }),
    ...(row.payload['reason'] === undefined ? {} : { reason: row.payload['reason'] }),
    ...(row.payload['capOboles'] === undefined ? {} : { cap: row.payload['capOboles'] }),
  }));

describe('règlement des décrets de dépense à la clôture', () => {
  it('dans l’ordre des votes, chacun contre le trésor restant ; non couvert, caduc ; une seule fois, même concurrente ou rejouée', async () => {
    const world = await newWorld(4_000);
    const works = await world.decree('public_works', { amountOboles: 600 }, 1);
    const feast = await world.decree(
      'festival',
      { amountOboles: 300, days: 2, goodIds: ['wheat'] },
      2,
    );
    const wonder = await world.decree('public_works', { amountOboles: 5_000 }, 3);
    const steps = [decreeTally, decreeApplication, decreeSpending];
    const runs = await Promise.all(
      [1, 2, 3].map(() =>
        closeWorld(db, { worldId: world.worldId, now: closeAt, config: loads(), steps }),
      ),
    );
    expect(runs.flat()).toEqual([TODAY]);
    expect(await statesOf([works, feast, wonder])).toEqual([
      'applied:today:true',
      'applied:today:true',
      'lapsed:today:false',
    ]);
    // Plafonds : 1 000 (25 % de 4 000), puis 850 (de 3 400), puis 775 (de 3 100), sous 5 000.
    expect(await eventsOf([works, feast, wonder])).toEqual([
      { type: 'DecreeApplied', decreeId: works, spent: 600 },
      { type: 'DecreeApplied', decreeId: feast, spent: 300 },
      { type: 'DecreeLapsed', decreeId: wonder, reason: 'uncovered', cap: 775 },
    ]);
    expect(await balancesOf(world.worldId)).toEqual({
      treasury: 3_100,
      sink_public_works: 600,
      sink_festivals: 300,
    });
    const summary = await sql<{
      summary: Record<string, unknown>;
    }>`select summary from game.daily_closes
      where world_id = ${world.worldId}`.execute(db);
    expect(summary.rows[0]?.summary['decreeSpending']).toEqual({
      applied: 2,
      spentOboles: 900,
      bounded: 0,
      lapsed: 1,
      unreadable: 0,
    });
    // Rejouée : la clôture du jour est déjà écrite ; l'étape seule ne trouve plus rien à régler.
    expect(await close(world.worldId)).toEqual([]);
    const again = await db
      .transaction()
      .execute((trx) =>
        decreeSpending.run({ trx, worldId: world.worldId, gameDay: TODAY + 1, closeAt, config }),
      );
    expect(again).toMatchObject({ applied: 0, lapsed: 0 });
    expect(await eventsOf([works, feast, wonder])).toHaveLength(3);
    expect((await balancesOf(world.worldId))['treasury']).toBe(3_100);
  });
});

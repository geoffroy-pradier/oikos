import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt, marketTax, tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWorld } from '../scheduler';
import { runTick } from '../tick';
import { decreeApplication } from './decree-application';
import { decreeSpending } from './decree-spending';
import { decreeTally } from './decree-tally';
import { npcDemand } from './npc-demand';

// Règlement des décrets de dépense à la clôture (#263), contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
const initial = INITIAL_CONFIG as GameConfig;
const models = initial.decrees?.models;
if (!initial.decrees || !models?.festival)
  throw new Error('decrees expected in the initial config');
// Plafond d'un décret : 25 % du trésor ; fête de blé, +50 % pour 30 000 oboles en un jour. Une classe de
// 1 000 habitants qui ne veut que du blé : 20 unités par tick au prix de référence (6).
const config: GameConfig = {
  ...initial,
  clock,
  market: { npcMaxPriceFactor: 3 },
  marketTax: { rateBps: 0, burnShareBps: 0 },
  npcClasses: [
    {
      id: 'thetes',
      qualitySensitivity: 0.1,
      incomePerThousand: 300,
      basket: [{ goodId: 'wheat', need: 'vital', quantityPerThousand: 20 }],
    },
  ],
  cities: [{ id: 'kalliste', population: { thetes: 1000 } }],
  decrees: {
    ...initial.decrees,
    spendingCapShareBps: 2_500,
    models: {
      ...models,
      festival: { ...models.festival, goodIds: ['wheat'], demandBoostBps: 5_000 },
    },
  },
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

/** 100 blés de l'archonte en vente à Kallistè, au prix de référence (6). */
const sellWheat = async (world: { worldId: string; cityId: string; houseId: string }) => {
  await sql`with i as (insert into game.inventories (world_id, house_id, city_id, good_id)
      values (${world.worldId}, ${world.houseId}, ${world.cityId}, 'wheat') returning id)
    insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
    select ${world.worldId}, 'wheat', 100, 'production', id, 'test.seed' from i`.execute(owner);
  await sql`insert into game.orders (world_id, house_id, city_id, good_id, side, price, quantity, remaining)
    values (${world.worldId}, ${world.houseId}, ${world.cityId}, 'wheat', 'sell', 6, 100, 100)`.execute(
    owner,
  );
};
/** Un tick des PNJ au jour de jeu donné, joué à son heure. */
const tickOn = async (worldId: string, day: number, given = config) => {
  const index = tickIndexAt(dailyCloseAt(day, clock), clock.tickMinutes) + 1;
  const scheduledAt = tickStart(index, clock.tickMinutes);
  const now = () => new Date(scheduledAt.getTime() + 1000);
  const tick = await runTick(db, {
    worldId,
    index,
    scheduledAt,
    config: loads(given),
    steps: [npcDemand],
    now,
  });
  return tick.summary['npcDemand'];
};

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

  it('plafond à l’obole près, trésor vide, montant ramené au maximum, modèle fermé, paramètres illisibles', async () => {
    const world = await newWorld(2_403);
    const exact = await world.decree('public_works', { amountOboles: 600 }, 1);
    const above = await world.decree('public_works', { amountOboles: 451 }, 2);
    const closed = await world.decree(
      'festival',
      { amountOboles: 300, days: 1, goodIds: ['wheat'] },
      3,
    );
    const unreadable = await world.decree('public_works', { amountOboles: 'beaucoup' }, 4);
    const poor = await newWorld(0);
    const nothing = await poor.decree('public_works', { amountOboles: 1 }, 1);
    const rich = await newWorld(10_000);
    const bounded = await rich.decree('public_works', { amountOboles: 2_000 }, 1);
    // Fêtes fermées depuis les votes ; puis maximum des grands travaux ramené à 400.
    const models = { ...config.decrees?.models };
    delete models.festival;
    const closedFeasts = { ...config, decrees: { ...initial.decrees, models } } as GameConfig;
    const works = { ...models, public_works: { minOboles: 300, maxOboles: 400 } };
    const narrowed = { ...config, decrees: { ...initial.decrees, models: works } } as GameConfig;
    expect(await close(world.worldId, closedFeasts)).toEqual([TODAY]);
    expect(await close(poor.worldId)).toEqual([TODAY]);
    expect(await close(rich.worldId, narrowed)).toEqual([TODAY]);
    expect(await statesOf([exact, above, closed, unreadable, nothing, bounded])).toEqual([
      'applied:today:true',
      'lapsed:today:false',
      'lapsed:today:false',
      'adopted:null:false',
      'lapsed:today:false',
      'applied:today:true',
    ]);
    // 2 403 : plafond 600, payé ; 1 803 : plafond 450, une obole de moins que 451.
    expect(await eventsOf([exact, above, closed, unreadable, nothing, bounded])).toEqual([
      { type: 'DecreeApplied', decreeId: exact, spent: 600 },
      { type: 'DecreeLapsed', decreeId: above, reason: 'uncovered', cap: 450 },
      { type: 'DecreeLapsed', decreeId: closed, reason: 'model_closed' },
      { type: 'DecreeLapsed', decreeId: nothing, reason: 'uncovered', cap: 0 },
      { type: 'DecreeApplied', decreeId: bounded, spent: 400 },
    ]);
    expect(await balancesOf(world.worldId)).toEqual({
      treasury: 1_803,
      sink_public_works: 600,
      sink_festivals: 0,
    });
    expect((await balancesOf(poor.worldId))['treasury']).toBe(0);
    expect((await balancesOf(rich.worldId))['treasury']).toBe(9_600);
  });

  it('fête : payée à la clôture, elle relève la demande des PNJ dès le jour qu’elle ouvre, pour ses jours', async () => {
    const world = await newWorld(120_000);
    const feast = await world.decree(
      'festival',
      { amountOboles: 30_000, days: 2, goodIds: ['wheat'] },
      1,
    );
    await sellWheat(world);
    expect(await close(world.worldId)).toEqual([TODAY]);
    expect(await eventsOf([feast])).toEqual([
      { type: 'DecreeApplied', decreeId: feast, spent: 30_000 },
    ]);
    // +5 000 ÷ 2 jours = +25 % : 25 blés par tick le jour de la clôture et le suivant, 20 ensuite.
    const units = [];
    for (const day of [TODAY, TODAY + 1, TODAY + 2]) units.push(await tickOn(world.worldId, day));
    expect(units).toMatchObject([{ units: 25 }, { units: 25 }, { units: 20 }]);
  });

  it('une clôture qui règle une dépense et un tick qui crédite le trésor : l’un après l’autre, sans interblocage', async () => {
    const world = await newWorld(4_000);
    const works = await world.decree('public_works', { amountOboles: 1_000 }, 1);
    await sellWheat(world);
    const rule = { rateBps: 1_000, burnShareBps: 5_000 };
    const taxed = { ...config, marketTax: rule };
    const [closed, bought] = await Promise.all([
      close(world.worldId, taxed),
      tickOn(world.worldId, TODAY, taxed),
    ]);
    expect(closed).toEqual([TODAY]);
    expect(bought).toMatchObject({ units: 20, spent: 120 });
    // Plafond de 1 000 au moins, que le tick passe avant ou après : payé, et la taxe gardée par la cité reste.
    expect(await eventsOf([works])).toEqual([
      { type: 'DecreeApplied', decreeId: works, spent: 1_000 },
    ]);
    expect(await balancesOf(world.worldId)).toEqual({
      treasury: 4_000 + marketTax(120, rule).treasury - 1_000,
      sink_public_works: 1_000,
      sink_festivals: 0,
    });
  });
});

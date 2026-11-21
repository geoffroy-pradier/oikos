import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyClose } from '../close';
import { liturgyEvasion, liturgyLevy } from './liturgy-settlement';

// Prélèvement d'office des liturgies (#720), contre Supabase local. Chaque test a son monde et joue des clôtures passées.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
const at = (day: number) => dailyCloseAt(day, clock);
const DUE_DAY = gameDayAt(new Date(), clock) - 5;
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
/** La clôture du jour, avec la perte de Timè d'une dérobade `loss` et la Timè bornée à `min`. */
const close = (worldId: string, gameDay: number, loss = 40, min = -10_000) =>
  runDailyClose(db, {
    worldId,
    gameDay,
    closeAt: at(gameDay),
    config: {
      at: async () => {
        const config: GameConfig = { ...initial, clock };
        config.liturgies = {
          ...(initial.liturgies as NonNullable<GameConfig['liturgies']>),
          evasionHonorLoss: loss,
        };
        config.honor = { min, max: 10_000, changes: { archon_term: 0 } };
        return { ...loaded, config };
      },
    },
    steps: [liturgyEvasion, liturgyLevy],
    now: new Date(),
  });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/**
 * Un monde à une cité ; chaque maison a sa trésorerie (dotée par le robinet de départ) et ses liturgies, de dû donné,
 * échues à la clôture `DUE_DAY + late` (zéro : celle du jour d'échéance). Posées par le propriétaire de la base,
 * gardes levées pour cette seule transaction : leur désignation demande une clôture du monde.
 */
async function newWorld(houses: { treasury: number; dues: number[]; late?: number }[]) {
  const [worldId, city] = [randomUUID(), randomUUID()];
  const ids = houses.map(() => randomUUID()).sort();
  const users = houses.map(() => randomUUID());
  const treasuries = houses.map((house) => house.treasury);
  await owner.transaction().execute(async (trx) => {
    for (const statement of [
      sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`s-${worldId.slice(0, 12)}`}, 'Test')`,
      sql`insert into game.cities (id, world_id, slug, name) values (${city}, ${worldId}, 'c0', 'Cité')`,
      sql`insert into auth.users (id, email) select u, u || '@example.test' from unnest(${users}::uuid[]) u`,
      sql`insert into game.houses (id, world_id, user_id, name, blazon)
        select h, ${worldId}, u, 'Maison ' || chr(96 + n::int), '{}' from unnest(${ids}::uuid[], ${users}::uuid[]) with ordinality v (h, u, n)`,
      sql`insert into game.citizenships (house_id, city_id) select h, ${city} from unnest(${ids}::uuid[]) h`,
      sql`insert into game.accounts (world_id, kind, house_id) select ${worldId}, 'house', h from unnest(${ids}::uuid[]) h`,
      // Dotation de chaque maison par le robinet de départ, une écriture par maison dotée.
      sql`with v as (select h, t from unnest(${ids}::uuid[], ${treasuries}::bigint[]) v (h, t) where t > 0),
        e as (insert into game.ledger_entries (world_id, kind, meta)
          select ${worldId}, 'house.starting_grant', jsonb_build_object('houseId', h) from v returning id, meta)
        insert into game.ledger_lines (entry_id, account_id, amount)
        select e.id, a.id, case when a.kind = 'house' then v.t else -v.t end
        from e join v on v.h::text = e.meta->>'houseId' join game.accounts a on a.world_id = ${worldId}
          and (a.house_id = v.h or a.system_key = 'faucet_starting_grant')`,
      sql`set local session_replication_role = replica`,
    ])
      await statement.execute(trx);
    for (const [index, house] of houses.entries())
      for (const [season, due] of house.dues.entries()) {
        const dueDay = DUE_DAY + (house.late ?? 0) - (house.dues.length - 1 - season);
        await sql`insert into game.liturgies (world_id, city_id, house_id, season, genre, due, designated_day, due_day,
            due_at) values (${worldId}, ${city}, ${ids[index]}, ${season}, 'festival', ${due}, ${dueDay - 3}, ${dueDay},
            ${at(dueDay)})`.execute(trx);
      }
  });
  return { worldId, ids };
}
const stateOf = async (worldId: string) =>
  (
    await sql<{
      s: string;
    }>`select string_agg(right(house_id::text, 1) || '#' || season || ':' || status || ':' || coalesce(paid::text, '-'),
        ' ' order by house_id, season) as s from game.liturgies where world_id = ${worldId}`.execute(
      db,
    )
  ).rows[0]?.s;
const holdingsOf = async (worldId: string) =>
  (
    await sql<{
      v: string[];
    }>`select array_agg(coalesce(a.balance, 0) || '/' || coalesce(t.honor, 0) order by h.id) as v
      from game.houses h left join game.accounts a on a.house_id = h.id and a.kind = 'house'
      left join game.honor t on t.house_id = h.id where h.world_id = ${worldId}`.execute(db)
  ).rows[0]?.v;
const sinkOf = async (worldId: string) => {
  const { rows } = await sql<{ b: string }>`select balance as b from game.accounts
    where world_id = ${worldId} and system_key = 'sink_liturgies'`.execute(db);
  return Number(rows[0]?.b);
};
const eventsOf = async (houseIds: string[], type: string) =>
  (
    await sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
      where type = ${type} and payload->>'houseId' = any(${houseIds}) order by seq`.execute(db)
  ).rows.map((row) => row.payload);

describe('prélèvement d’office des liturgies échues (#720)', () => {
  it('en entier, en partie, rien sur une trésorerie vide ; Timè perdue une fois ; rejouée, rien deux fois', async () => {
    // a : 1 000 pour 600 ; b : 300 pour 500 ; c : rien pour 400 ; d : 700 pour 500 puis 400 ; e : échue demain.
    const { worldId, ids } = await newWorld([
      { treasury: 1_000, dues: [600] },
      { treasury: 300, dues: [500] },
      { treasury: 0, dues: [400] },
      { treasury: 700, dues: [500, 400] },
      { treasury: 900, dues: [800], late: 1 },
    ]);
    const outcome = await close(worldId, DUE_DAY);
    expect(outcome.summary).toEqual({
      liturgyEvasion: { evaded: 5, honorLost: 200 },
      liturgyLevy: { levied: 5, leviedOboles: 600 + 300 + 0 + 500 + 200, partial: 3 },
    });
    const tag = (index: number) => ids[index]?.slice(-1);
    expect(await stateOf(worldId)).toBe(
      [
        `${tag(0)}#0:levied:600`,
        `${tag(1)}#0:levied:300`,
        `${tag(2)}#0:levied:0`,
        `${tag(3)}#0:levied:500`,
        `${tag(3)}#1:levied:200`,
        `${tag(4)}#0:assigned:-`,
      ].join(' '),
    );
    expect(await holdingsOf(worldId)).toEqual(['400/-40', '0/-40', '0/-40', '0/-80', '900/0']);
    expect(await sinkOf(worldId)).toBe(1_600);
    // Une écriture par liturgie qui a pris quelque chose ; aucune pour la trésorerie vide.
    const entries = await sql<{ n: number }>`select count(*)::int as n from game.ledger_entries
      where world_id = ${worldId} and kind = 'liturgy.levy'`.execute(db);
    expect(entries.rows).toEqual([{ n: 4 }]);
    const levied = await eventsOf([ids[1] ?? ''], 'LiturgyLevied');
    expect(levied).toEqual([
      expect.objectContaining({
        houseId: ids[1],
        due: 500,
        levied: 300,
        honorLost: 40,
        gameDay: DUE_DAY,
      }),
    ]);
    expect(await eventsOf([ids[2] ?? ''], 'HonorChanged')).toEqual([
      { houseId: ids[2], amount: -40, reason: 'liturgy_evaded', balance: -40 },
    ]);
    // Rejouée, la clôture est ignorée ; la suivante prélève la seule liturgie échue depuis, sans rien reprendre.
    expect((await close(worldId, DUE_DAY)).status).toBe('skipped');
    expect((await close(worldId, DUE_DAY + 1)).summary).toEqual({
      liturgyEvasion: { evaded: 1, honorLost: 40 },
      liturgyLevy: { levied: 1, leviedOboles: 800, partial: 0 },
    });
    expect(await holdingsOf(worldId)).toEqual(['400/-40', '0/-40', '0/-40', '0/-80', '100/-40']);
    expect(await sinkOf(worldId)).toBe(2_400);
    expect((await close(worldId, DUE_DAY + 2)).summary).toEqual({
      liturgyEvasion: { evaded: 0, honorLost: 0 },
      liturgyLevy: { levied: 0, leviedOboles: 0, partial: 0 },
    });
  });

  it('deux moteurs à la fois : une seule clôture prélève ; perte nulle ou rognée à la borne de la Timè', async () => {
    const { worldId, ids } = await newWorld([{ treasury: 250, dues: [100] }]);
    const outcomes = await Promise.all([close(worldId, DUE_DAY, 0), close(worldId, DUE_DAY, 0)]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['done', 'skipped']);
    expect(await holdingsOf(worldId)).toEqual(['150/0']);
    expect(await eventsOf([ids[0] ?? ''], 'HonorChanged')).toEqual([]);
    expect(await eventsOf([ids[0] ?? ''], 'LiturgyLevied')).toEqual([
      expect.objectContaining({ levied: 100, honorLost: 0 }),
    ]);
    // Timè au plus bas à −25 : une perte de 40 est rognée à 25.
    const capped = await newWorld([{ treasury: 0, dues: [100] }]);
    expect((await close(capped.worldId, DUE_DAY, 40, -25)).summary).toMatchObject({
      liturgyEvasion: { evaded: 1, honorLost: 25 },
    });
    expect(await holdingsOf(capped.worldId)).toEqual(['0/-25']);
  });
});

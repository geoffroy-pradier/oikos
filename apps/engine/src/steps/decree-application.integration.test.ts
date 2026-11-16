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
import { sql, type RawBuilder } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWorld } from '../scheduler';
import { runTick } from '../tick';
import { decreeApplication } from './decree-application';
import { decreeTally } from './decree-tally';
import { npcDemand } from './npc-demand';

// Application des décrets de taux à la clôture (#262), contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
// Une classe de 1 000 habitants qui ne veut que du blé, taxe du monde de 5 %, bornes des décrets initiales.
const config: GameConfig = {
  ...(INITIAL_CONFIG as GameConfig),
  clock,
  market: { npcMaxPriceFactor: 3 },
  marketTax: { rateBps: 500, burnShareBps: 5_000 },
  npcClasses: [
    {
      id: 'thetes',
      qualitySensitivity: 0.1,
      incomePerThousand: 300,
      basket: [{ goodId: 'wheat', need: 'vital', quantityPerThousand: 20 }],
    },
  ],
  cities: [{ id: 'kalliste', population: { thetes: 1000 } }],
};
let active: LoadedConfig;
const loads = (given: GameConfig = config) => ({
  at: async () => ({ ...active, config: given }),
  byId: createConfigLoader(db).byId,
});
const TODAY = gameDayAt(new Date(), clock);
const closeAt = dailyCloseAt(TODAY, clock);

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  active = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Un monde, Kallistè, une maison citoyenne et archonte en charge, posés garde levée. */
async function newWorld() {
  const [worldId, cityId, houseId, userId, officeId] = [1, 2, 3, 4, 5].map(() => randomUUID());
  const ids = { worldId: worldId ?? '', cityId: cityId ?? '', houseId: houseId ?? '' };
  const guards = (on: boolean, tables: string[]) =>
    tables.map(
      (name) => sql`alter table ${sql.table(`game.${name}`)} ${sql.raw(on ? 'enable' : 'disable')}
      trigger ${sql.ref(`${name}_guard`)}`,
    );
  const run = (queries: RawBuilder<unknown>[]) =>
    owner.transaction().execute(async (trx) => {
      for (const query of queries) await query.execute(trx);
    });
  await run([
    sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`r-${ids.worldId.slice(0, 12)}`}, 'Test')`,
    sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'K')`,
    sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`,
    sql`insert into game.houses (id, world_id, user_id, name, blazon)
      values (${houseId}, ${worldId}, ${userId}, ${`Maison ${ids.houseId.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}')`,
    sql`insert into game.accounts (world_id, kind, house_id) values (${worldId}, 'house', ${houseId})`,
    sql`insert into game.citizenships (house_id, city_id) values (${houseId}, ${cityId})`,
    ...guards(false, ['citizenships', 'elections', 'offices']),
    sql`update game.citizenships set status = 'citizen', since = now() - interval '10 days' where house_id = ${houseId}`,
    sql`with e as (insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
        values (${worldId}, ${cityId}, 'archon', now() - interval '9 days', now() - interval '8 days', now() - interval '7 days', now() + interval '20 days', now())
        returning *)
      insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
      select ${officeId}, world_id, city_id, office, ${houseId}, id, voting_closes_at, term_ends_at from e`,
    ...guards(true, ['citizenships', 'elections', 'offices']),
  ]);
  /** Un décret dont le vote finit à la clôture du jour, avec le vote pour de la maison ; ou déjà adopté. */
  const decree = async (model: string, params: object, status = 'proposed') => {
    const decreeId = randomUUID();
    const tally = status === 'adopted' ? sql`now(), 1, 1, 0` : sql`null, null, null, null`;
    await run([
      ...guards(false, ['decrees', 'decree_votes']),
      sql`insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at,
          voting_closes_at, quorum_bps, status, tallied_at, electorate, votes_for, votes_against)
        values (${decreeId}, ${worldId}, ${cityId}, ${model}, ${JSON.stringify(params)}::jsonb, ${officeId}, ${houseId},
          now() - interval '3 days', ${closeAt}, 0, ${status}, ${tally})`,
      sql`insert into game.decree_votes (decree_id, house_id, approve, cast_at)
        values (${decreeId}, ${houseId}, true, now() - interval '2 days')`,
      ...guards(true, ['decrees', 'decree_votes']),
    ]);
    return decreeId;
  };
  /** Des ventes de 10 blés de la maison à Kallistè, une par prix. */
  const sell = (prices: number[]) =>
    run([
      sql`with i as (insert into game.inventories (world_id, house_id, city_id, good_id)
          values (${worldId}, ${houseId}, ${cityId}, 'wheat') returning id)
        insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
        select ${worldId}, 'wheat', ${10 * prices.length}, 'production', id, 'test.seed' from i`,
      ...prices.map(
        (
          price,
        ) => sql`insert into game.orders (world_id, house_id, city_id, good_id, side, price, quantity, remaining)
          values (${worldId}, ${houseId}, ${cityId}, 'wheat', 'sell', ${price}, 10, 10)`,
      ),
    ]);
  return { ...ids, decree, sell };
}
const stateOf = async (decreeId: string) =>
  (
    await sql<{
      state: string;
    }>`select status || ':' || coalesce((applied_at = tallied_at)::text, '-') as state
      from game.decrees where id = ${decreeId}`.execute(db)
  ).rows[0]?.state;
const appliedEvents = async (decreeId: string) =>
  (
    await sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
      where type = 'DecreeApplied' and payload->>'decreeId' = ${decreeId}`.execute(db)
  ).rows.map((row) => row.payload);
const apply = (worldId: string, given: GameConfig = config) =>
  db
    .transaction()
    .execute((trx) =>
      decreeApplication.run({ trx, worldId, gameDay: TODAY, closeAt, config: given }),
    );

describe('application des décrets de taux à la clôture', () => {
  it('dépouillé puis appliqué à la même clôture, une seule fois même rejouée ; les PNJ achètent ensuite au taux de la cité', async () => {
    const world = await newWorld();
    const tax = await world.decree('market_tax_rate', { rateBps: 800 });
    const port = await world.decree('port_dues', { coefficientBps: 15_000 });
    const works = await world.decree('public_works', { amountOboles: 600 });
    const steps = [decreeTally, decreeApplication];
    const runs = await Promise.all(
      [1, 2, 3].map(() =>
        closeWorld(db, { worldId: world.worldId, now: closeAt, config: loads(), steps }),
      ),
    );
    expect(runs.flat()).toEqual([TODAY]);
    expect(await Promise.all([tax, port, works].map(stateOf))).toEqual([
      'applied:true',
      'applied:true',
      'adopted:-',
    ]);
    expect(await appliedEvents(tax)).toEqual([
      {
        decreeId: tax,
        cityId: world.cityId,
        decree: { model: 'market_tax_rate', params: { rateBps: 800 } },
        inForceBps: 800,
      },
    ]);
    expect((await appliedEvents(port)).map((event) => event['inForceBps'])).toEqual([15_000]);
    expect(await appliedEvents(works)).toEqual([]);
    const close = await sql<{
      summary: Record<string, unknown>;
    }>`select summary from game.daily_closes where world_id = ${world.worldId}`.execute(db);
    expect(close.rows[0]?.summary['decreeApplication']).toEqual({
      applied: 2,
      bounded: 0,
      unreadable: 0,
    });
    // Rejouée hors de la clôture, l'étape ne retrouve rien à appliquer.
    expect(await apply(world.worldId)).toEqual({ applied: 0, bounded: 0, unreadable: 0 });
    expect(await appliedEvents(tax)).toHaveLength(1);

    // Les PNJ achètent 10 blés à 5 puis 10 à 6 : chaque échange est taxé à 8 %, au profit de Kallistè.
    await world.sell([5, 6]);
    const index = tickIndexAt(new Date(), clock.tickMinutes) + 1;
    const scheduledAt = tickStart(index, clock.tickMinutes);
    const tick = await runTick(db, {
      worldId: world.worldId,
      index,
      scheduledAt,
      config: loads(),
      steps: [npcDemand],
      now: () => new Date(scheduledAt.getTime() + 1000),
    });
    expect(tick.summary['npcDemand']).toMatchObject({ units: 20, spent: 110 });
    const taxes = [50, 60].map((gross) => marketTax(gross, { rateBps: 800, burnShareBps: 5_000 }));
    const { rows } = await sql<{
      kind: string;
      balance: string;
    }>`select kind, balance from game.accounts
      where world_id = ${world.worldId} and kind in ('house', 'treasury')`.execute(db);
    expect(Object.fromEntries(rows.map((row) => [row.kind, Number(row.balance)]))).toEqual({
      house: taxes.reduce((sum, tax) => sum + tax.net, 0),
      treasury: taxes.reduce((sum, tax) => sum + tax.treasury, 0),
    });
  });

  it('revalidé à la clôture : hors des bornes resserrées depuis le vote, il vaut la borne ; modèle fermé, sans effet', async () => {
    const world = await newWorld();
    const tax = await world.decree('market_tax_rate', { rateBps: 950 }, 'adopted');
    const port = await world.decree('port_dues', { coefficientBps: 15_000 }, 'adopted');
    // Bornes du taux resserrées depuis le vote, droit de port que le monde ne borne plus.
    const bounds = { market_tax_rate: { minRateBps: 200, maxRateBps: 600 }, port_dues: undefined };
    const decrees = config.decrees && {
      ...config.decrees,
      models: { ...config.decrees.models, ...bounds },
    };
    const narrowed: GameConfig = { ...config, decrees };
    expect(await apply(world.worldId, narrowed)).toEqual({ applied: 2, bounded: 2, unreadable: 0 });
    expect([await stateOf(tax), await stateOf(port)]).toEqual(['applied:false', 'applied:false']);
    // La valeur votée reste dans l'événement ; la valeur en vigueur est la borne, ou celle du monde.
    expect(await appliedEvents(tax)).toEqual([
      {
        decreeId: tax,
        cityId: world.cityId,
        decree: { model: 'market_tax_rate', params: { rateBps: 950 } },
        inForceBps: 600,
      },
    ]);
    expect((await appliedEvents(port)).map((event) => event['inForceBps'])).toEqual([10_000]);
  });
});

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
import { closeWorld } from '../scheduler';
import { leaseRent } from './lease-rent';
import { siteUpkeep } from './site-upkeep';

// Loyers des baux à la clôture (#257), contre Supabase local. Chaque test a son monde, sa cité, trois
// maisons : Alice, propriétaire de deux maisons de ville achetées il y a dix jours, et deux locataires.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
/** Entretien d'une maison de ville : 12 par jour, payé avec ce qui reste après les loyers. */
const UPKEEP = 12;
const properties = {
  ...initial.properties,
  sizes: initial.properties.sizes.map((size) => ({
    ...size,
    dailyUpkeepOboles: UPKEEP,
    dailyWear: 0,
  })),
};
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const settings = { at: async () => ({ ...loaded, config: { ...initial, clock, properties } }) };
const TODAY = gameDayAt(new Date(), clock);
const close = (worldId: string, day = TODAY) =>
  closeWorld(db, {
    worldId,
    now: dailyCloseAt(day, clock),
    config: settings,
    steps: [leaseRent, siteUpkeep],
  });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/**
 * Le monde : Alice (`alice` oboles) possède deux biens, loués à Bob et à Chloé (`bob`, `chloe` oboles)
 * au loyer `rent`, baux signés il y a deux jours dans cet ordre (gardes levées le temps d'antidater).
 */
async function newWorld(alice: number, bob: number, chloe: number, rent = 40) {
  const worldId = randomUUID();
  const cityId = randomUUID();
  const houses = [randomUUID(), randomUUID(), randomUUID()] as const;
  const leases: string[] = [];
  await owner.transaction().execute(async (trx) => {
    await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`n-${worldId.slice(0, 12)}`}, 'Test'))
      insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Port')`.execute(
      trx,
    );
    for (const houseId of houses)
      await sql`with player as (insert into auth.users (id, email) values (${houseId}, ${`${houseId}@example.test`})),
        house as (insert into game.houses (id, world_id, user_id, name, blazon)
          values (${houseId}, ${worldId}, ${houseId}, ${`Maison ${houseId.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}'))
        insert into game.accounts (world_id, kind, house_id) values (${worldId}, 'house', ${houseId})`.execute(
        trx,
      );
    const created = await sql<{
      id: string;
    }>`insert into game.properties (world_id, city_id, size_id, lot)
      values (${worldId}, ${cityId}, 'townhouse', 1), (${worldId}, ${cityId}, 'townhouse', 2) returning id`.execute(
      trx,
    );
    await sql`set constraints all immediate`.execute(trx);
    await sql`alter table game.properties disable trigger properties_guard`.execute(trx);
    await sql`alter table game.property_listings disable trigger property_listings_guard`.execute(
      trx,
    );
    await sql`alter table game.leases disable trigger leases_guard`.execute(trx);
    for (const [index, { id }] of created.rows.entries()) {
      const tenant = houses[index + 1] ?? '';
      await sql`update game.properties set owner_house_id = ${houses[0]}, acquired_at = now() - interval '10 days'
        where id = ${id}`.execute(trx);
      const lease = await sql<{ id: string }>`with listing as (
          insert into game.property_listings (world_id, property_id, house_id, kind, price_oboles, created_at, closed_at, outcome)
          values (${worldId}, ${id}, ${houses[0]}, 'lease', ${rent}, now() - interval '3 days', now() - interval '2 days', 'leased')
          returning id)
        insert into game.leases (world_id, property_id, listing_id, landlord_house_id, tenant_house_id, rent_oboles, started_at)
        select ${worldId}, ${id}, listing.id, ${houses[0]}, ${tenant}, ${rent}, now() - interval '2 days' + ${index} * interval '1 minute'
        from listing returning id`.execute(trx);
      leases.push(lease.rows[0]?.id ?? '');
    }
    await sql`alter table game.properties enable trigger properties_guard`.execute(trx);
    await sql`alter table game.property_listings enable trigger property_listings_guard`.execute(
      trx,
    );
    await sql`alter table game.leases enable trigger leases_guard`.execute(trx);
  });
  for (const [houseId, oboles] of [
    [houses[0], alice],
    [houses[1], bob],
    [houses[2], chloe],
  ] as const)
    if (oboles > 0)
      await sql`with entry as (insert into game.ledger_entries (world_id, kind) values (${worldId}, 'test.seed') returning id)
        insert into game.ledger_lines (entry_id, account_id, amount)
        select entry.id, a.id, case when a.kind = 'house' then ${oboles}::bigint else -${oboles}::bigint end from entry, game.accounts a
        where a.world_id = ${worldId} and (a.house_id = ${houseId} or a.system_key = 'faucet_starting_grant')`.execute(
        owner,
      );
  return { worldId, houses, leases };
}
type World = Awaited<ReturnType<typeof newWorld>>;
/** Trésoreries d'Alice, Bob et Chloé, puis le puits de l'entretien des biens. */
const balances = async ({ worldId, houses }: World) => {
  const { rows } = await sql<{ house_id: string | null; balance: string }>`select house_id, balance
    from game.accounts where world_id = ${worldId} and (kind = 'house' or system_key = 'sink_property_upkeep')`.execute(
    db,
  );
  const of = (id: string | null) => Number(rows.find((row) => row.house_id === id)?.balance);
  return [...houses.map(of), of(null)];
};
const leasesOf = async ({ leases }: World) =>
  (
    await sql<{
      ended_day: number | null;
      end_reason: string | null;
    }>`select ended_day, end_reason from game.leases
      where id = any(${leases}::uuid[]) order by array_position(${leases}::uuid[], id)`.execute(db)
  ).rows.map((row) => [row.ended_day, row.end_reason]);
const rentsOf = async ({ worldId }: World) =>
  (
    await sql<{
      lease_id: string;
      day: number;
      amount: string;
    }>`select e.meta->>'leaseId' as lease_id,
      (e.meta->>'gameDay')::int as day, l.amount from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
      where e.world_id = ${worldId} and e.kind = 'lease.rent' and l.amount > 0 order by e.created_at, day`.execute(
      db,
    )
  ).rows.map((row) => [row.lease_id, row.day, Number(row.amount)]);
const endedEvents = async ({ leases }: World) =>
  (
    await sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
      where type = 'LeaseEnded' and payload->>'leaseId' = any(${leases}) order by seq`.execute(db)
  ).rows.map((row) => [row.payload['leaseId'], row.payload['reason'], row.payload['gameDay']]);

describe('loyers des baux à la clôture quotidienne', () => {
  it('chaque bail paie son loyer, avant l’entretien ; impayé, il prend fin ; la monnaie ne fait que passer', async () => {
    // Alice n'a rien : seul le loyer de Bob lui paie l'entretien de ses deux biens. Chloé n'a pas 40.
    const world = await newWorld(0, 100, 39);
    const [bobLease, chloeLease] = world.leases;
    const before = await balances(world);
    expect(await close(world.worldId, TODAY - 1)).toEqual([TODAY - 1]);
    expect(await balances(world)).toEqual([40 - 2 * UPKEEP, 60, 39, 2 * UPKEEP]);
    const after = await balances(world);
    expect(after.reduce((sum, value) => sum + value, 0)).toBe(
      before.reduce((sum, value) => sum + value, 0),
    );
    expect(await rentsOf(world)).toEqual([[bobLease, TODAY - 1, 40]]);
    expect(await leasesOf(world)).toEqual([
      [null, null],
      [TODAY - 1, 'unpaid'],
    ]);
    expect(await endedEvents(world)).toEqual([[chloeLease, 'unpaid', TODAY - 1]]);

    // Rejouée, la clôture ne fait rien ; la suivante redemande le loyer de Bob seul.
    expect(await close(world.worldId, TODAY - 1)).toEqual([]);
    expect(await balances(world)).toEqual(after);
    expect(await close(world.worldId)).toEqual([TODAY]);
    expect(await rentsOf(world)).toEqual([
      [bobLease, TODAY - 1, 40],
      [bobLease, TODAY, 40],
    ]);
    expect(await balances(world)).toEqual([56 - 2 * UPKEEP, 20, 39, 4 * UPKEEP]);
  });

  it('une fin demandée prend effet à la clôture, sans loyer ; un loyer égal à la trésorerie se paie', async () => {
    const world = await newWorld(0, 40, 40);
    const [bobLease, chloeLease] = world.leases;
    await db
      .updateTable('game.leases')
      .set({ end_requested_by: 'tenant' })
      .where('id', '=', chloeLease ?? '')
      .execute();
    await close(world.worldId);
    expect(await balances(world)).toEqual([40 - 2 * UPKEEP, 0, 40, 2 * UPKEEP]);
    expect(await rentsOf(world)).toEqual([[bobLease, TODAY, 40]]);
    expect(await leasesOf(world)).toEqual([
      [null, null],
      [TODAY, 'requested'],
    ]);
    expect(await endedEvents(world)).toEqual([[chloeLease, 'requested', TODAY]]);
  });

  it('un bail signé après l’instant de la clôture ne doit rien à cette clôture', async () => {
    const world = await newWorld(0, 100, 100);
    // Les deux baux signés « maintenant » : après l'instant de la clôture du jour, jouée en retard.
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.leases disable trigger leases_guard`.execute(trx);
      await sql`update game.leases set started_at = now() where world_id = ${world.worldId}`.execute(
        trx,
      );
      await sql`alter table game.leases enable trigger leases_guard`.execute(trx);
    });
    await close(world.worldId);
    expect(await rentsOf(world)).toEqual([]);
    expect(await leasesOf(world)).toEqual([
      [null, null],
      [null, null],
    ]);
    expect((await balances(world)).slice(0, 3)).toEqual([0, 100, 100]);
  });
});

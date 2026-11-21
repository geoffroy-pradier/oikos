import { randomUUID } from 'node:crypto';
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { createRng, tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { voyageArrivals } from './voyage-arrivals';

// Jeux d'essai de l'arrivée des voyages (#253), posés par le propriétaire de la base ; le code testé agit
// sous le rôle de service, comme en production.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const db = createDb(serviceRoleUrl(DATABASE_URL));
export const owner = createDb(DATABASE_URL);

/** Un monde neuf et ses deux cités : Kallistè, d'où l'on part, et Elaia, où l'on arrive. */
export async function newWorld() {
  const [worldId, kalliste, elaia] = [randomUUID(), randomUUID(), randomUUID()];
  await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`v-${worldId.slice(0, 12)}`}, 'Test'))
    insert into game.cities (id, world_id, slug, name)
    values (${kalliste}, ${worldId}, 'kalliste', 'Kallistè'), (${elaia}, ${worldId}, 'elaia', 'Elaia')`.execute(
    owner,
  );
  return { worldId, kalliste, elaia };
}
export type World = Awaited<ReturnType<typeof newWorld>>;

/** Pose `quantity` unités produites dans l'entrepôt de la maison dans la cité. */
export async function give(
  world: World,
  houseId: string,
  cityId: string,
  goodId: string,
  quantity: number,
) {
  await sql`insert into game.inventories (world_id, house_id, city_id, good_id)
    values (${world.worldId}, ${houseId}, ${cityId}, ${goodId}) on conflict do nothing`.execute(
    owner,
  );
  await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
    select ${world.worldId}, ${goodId}, ${quantity}, 'production', id, 'test' from game.inventories
    where house_id = ${houseId} and city_id = ${cityId} and good_id = ${goodId}`.execute(owner);
}

/** Une maison du monde et `ships` caboteurs à quai à Kallistè ; 100 blés et 50 huiles à Kallistè. */
export async function newHouse(world: World, ships = 1) {
  const [userId, houseId] = [randomUUID(), randomUUID()];
  await sql`with player as (insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`}))
    insert into game.houses (id, world_id, user_id, name, blazon)
    values (${houseId}, ${world.worldId}, ${userId}, ${`Maison ${houseId.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}')`.execute(
    owner,
  );
  const { rows } = await sql<{
    id: string;
  }>`insert into game.ships (world_id, house_id, class_id, docked_city_id)
    select ${world.worldId}, ${houseId}, 'coaster', ${world.kalliste} from generate_series(1, ${ships})
    returning id`.execute(owner);
  await give(world, houseId, world.kalliste, 'wheat', 100);
  await give(world, houseId, world.kalliste, 'olive_oil', 50);
  return { houseId, shipIds: rows.map((row) => row.id).sort() };
}

/**
 * Un navire part de Kallistè vers Elaia avec sa cargaison, chargée depuis l'entrepôt de Kallistè, puis son
 * départ et son échéance sont antidatés (arrivée prévue : `arrivesAt`), gardes des voyages levées le temps
 * de les réécrire, dans une seconde transaction : le départ lui-même passe toutes les gardes. `lossRiskBps` :
 * le risque de perte fixé au départ (#730).
 */
export async function sail(
  world: World,
  houseId: string,
  shipId: string,
  arrivesAt: Date,
  cargo: Record<string, number> = {},
  lossRiskBps = 0,
) {
  const voyageId = await owner.transaction().execute(async (trx) => {
    const { rows } = await sql<{ id: string }>`insert into game.voyages
      (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at, loss_risk_bps)
      values (${world.worldId}, ${houseId}, ${shipId}, ${world.kalliste}, ${world.elaia}, now() + interval '1 hour', ${lossRiskBps})
      returning id`.execute(trx);
    const id = rows[0]?.id ?? '';
    for (const [goodId, quantity] of Object.entries(cargo)) {
      await sql`insert into game.voyage_cargo (voyage_id, world_id, good_id, quantity)
        values (${id}, ${world.worldId}, ${goodId}, ${quantity})`.execute(trx);
      await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind, voyage_id)
        select ${world.worldId}, ${goodId}, ${quantity}, id, 'in_transit', 'voyage.departure', ${id}
        from game.inventories where house_id = ${houseId} and city_id = ${world.kalliste} and good_id = ${goodId}`.execute(
        trx,
      );
    }
    await sql`update game.ships set docked_city_id = null where id = ${shipId}`.execute(trx);
    return id;
  });
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.voyages disable trigger voyages_guard, disable trigger voyages_settled`.execute(
      trx,
    );
    await sql`update game.voyages set departed_at = ${arrivesAt}::timestamptz - interval '1 hour',
      arrives_at = ${arrivesAt} where id = ${voyageId}`.execute(trx);
    await sql`alter table game.voyages enable trigger voyages_guard, enable trigger voyages_settled`.execute(
      trx,
    );
  });
  return voyageId;
}

/** Stocks de la maison, par cité (`kalliste`, `elaia`) puis par bien. */
export async function stocks(world: World, houseId: string) {
  const { rows } = await sql<{ city_id: string; good_id: string; quantity: string }>`
    select city_id, good_id, quantity from game.inventories where house_id = ${houseId}`.execute(
    owner,
  );
  const of = (cityId: string) =>
    Object.fromEntries(
      rows
        .filter((row) => row.city_id === cityId && Number(row.quantity) > 0)
        .map((row) => [row.good_id, Number(row.quantity)]),
    );
  return { kalliste: of(world.kalliste), elaia: of(world.elaia) };
}

/** Le voyage, son navire et les événements `VoyageArrived` qui le nomment. */
export async function voyageState(voyageId: string) {
  const voyage = await owner
    .selectFrom('game.voyages as v')
    .innerJoin('game.ships as s', 's.id', 'v.ship_id')
    .select(['v.arrives_at', 'v.arrived_at', 's.docked_city_id', 's.laid_up_at'])
    .where('v.id', '=', voyageId)
    .executeTakeFirstOrThrow();
  const events = await owner
    .selectFrom('game.domain_events')
    .select(['command_id', 'payload'])
    .where('type', '=', 'VoyageArrived')
    .where(sql<boolean>`payload->>'voyageId' = ${voyageId}`)
    .execute();
  return { ...voyage, events };
}

export const TICK_MINUTES = (INITIAL_CONFIG as GameConfig).clock.tickMinutes;
/** Début du tick en cours, ou d'un tick précédent : passé, comme l'instant de tout tick que le moteur joue. */
export const currentTick = (back = 0) =>
  tickStart(tickIndexAt(new Date(), TICK_MINUTES) - back, TICK_MINUTES);

/** Joue l'étape seule, dans sa transaction, comme le tick de l'instant `scheduledAt`. */
export const arrive = (world: World, scheduledAt: Date) =>
  db.transaction().execute((trx) =>
    voyageArrivals.run({
      trx,
      worldId: world.worldId,
      index: tickIndexAt(scheduledAt, TICK_MINUTES),
      scheduledAt,
      config: INITIAL_CONFIG as GameConfig,
      rng: createRng('0'),
      dailyClose: false,
      seasonSwitch: false,
      catchUp: false,
    }),
  );

/**
 * Par bien : ce que contiennent les stocks du monde, plus ce qui est en mer, plus ce qui est perdu en mer (#730),
 * contre ce qui a été produit.
 */
export const conservation = async ({ worldId }: World) =>
  (
    await sql<{ good_id: string; held: string; produced: string }>`
      select l.good_id,
        (select coalesce(sum(i.quantity), 0) from game.inventories i where i.world_id = ${worldId} and i.good_id = l.good_id)
          + coalesce(sum(l.quantity) filter (where l.to_system = 'in_transit'), 0)
          - coalesce(sum(l.quantity) filter (where l.from_system = 'in_transit'), 0)
          + coalesce(sum(l.quantity) filter (where l.to_system = 'lost_at_sea'), 0) as held,
        sum(l.quantity) filter (where l.from_system = 'production') as produced
      from game.stock_ledger l where l.world_id = ${worldId} group by l.good_id`.execute(owner)
  ).rows.every((row) => row.held === row.produced);

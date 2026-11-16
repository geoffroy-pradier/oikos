import { ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';

/**
 * Planifie un événement comme la clôture (#267), sous la garde de la base : il commence dans `inMs`
 * millisecondes à l'horloge de la base (un événement déjà commencé est refusé) et dure `lastsMs`. Son jour de
 * planification, le suivant de la dernière clôture du monde, est enregistré comme une clôture jouée dans la même
 * transaction, après lui. Les jours de l'événement sont fictifs : seuls ses instants comptent ici.
 */
export async function planEvent(
  owner: Db,
  event: {
    worldId: string;
    model: 'drought' | 'good_year' | 'storm' | 'caravan';
    cityId: string;
    otherCityId?: string;
    goodId?: string;
    magnitudeBps: number;
    inMs: number;
    lastsMs: number;
  },
) {
  // La clôture enregistrée lit une version de configuration : celle de départ, posée au besoin.
  await ensureInitialConfig(owner, INITIAL_CONFIG);
  return owner.transaction().execute(async (trx) => {
    const { rows } = await sql<{ now: Date; day: number }>`select clock_timestamp() as now,
      coalesce((select max(game_day) from game.daily_closes where world_id = ${event.worldId}), 0) + 1 as day`.execute(
      trx,
    );
    const clock = rows[0];
    if (!clock) throw new Error('The database returned no clock');
    const startsAt = new Date(clock.now.getTime() + event.inMs);
    const { id } = await trx
      .insertInto('game.world_events')
      .values({
        world_id: event.worldId,
        model: event.model,
        city_id: event.cityId,
        other_city_id: event.otherCityId ?? null,
        good_id: event.goodId ?? null,
        planned_day: clock.day,
        start_day: clock.day + 1,
        end_day: clock.day + 2,
        starts_at: startsAt,
        ends_at: new Date(startsAt.getTime() + event.lastsMs),
        magnitude_bps: event.magnitudeBps,
        seed: '0'.repeat(64),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await sql`insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
      values (${event.worldId}, ${clock.day}, now(), (select id from config.versions order by id limit 1))`.execute(
      trx,
    );
    return { eventId: id, startsAt };
  });
}

/** Attend que l'horloge de la base dépasse l'instant donné. */
export async function waitUntil(db: Db, instant: Date) {
  for (;;) {
    const { rows } = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(db);
    const now = rows[0]?.now ?? new Date(0);
    if (now > instant) return;
    await new Promise((resolve) => setTimeout(resolve, instant.getTime() - now.getTime() + 20));
  }
}

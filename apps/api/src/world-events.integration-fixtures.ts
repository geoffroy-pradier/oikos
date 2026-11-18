import { ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';

/**
 * Planifie un événement comme la clôture (#267), sous la garde de la base : il commence dans `inMs`
 * millisecondes à l'horloge de la base (un événement déjà commencé est refusé) et dure `lastsMs`. Son jour de
 * planification, le suivant de la dernière clôture du monde, est enregistré comme une clôture jouée dans la même
 * transaction, après lui. Les jours de l'événement sont fictifs : seuls ses instants comptent ici. Avec `oracle`,
 * son oracle de repli est écrit dans la même transaction, comme par la planification (#270).
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
    oracle?: { fr: string; en: string };
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
    const oracle = event.oracle
      ? await trx
          .insertInto('game.oracles')
          .values({
            world_id: event.worldId,
            event_id: id,
            text_fr: event.oracle.fr,
            text_en: event.oracle.en,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      : null;
    await sql`insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
      values (${event.worldId}, ${clock.day}, now(), (select id from config.versions order by id limit 1))`.execute(
      trx,
    );
    return { eventId: id, startsAt, oracleId: oracle?.id ?? null };
  });
}

/**
 * Pose un événement déjà commencé, voire fini, aux instants donnés : la garde, qui refuse un événement planifié
 * après son début, est levée le temps de l'insertion par le propriétaire de la base. Son jour de planification
 * est enregistré comme une clôture jouée, comme par `planEvent`, mais avant lui : la garde levée ne le refuse pas,
 * et la clé vers la clôture, vérifiée aussitôt, ne laisse rien en attente qui empêcherait de la rétablir.
 */
export async function pastEvent(
  owner: Db,
  event: {
    worldId: string;
    model: 'drought' | 'good_year' | 'storm' | 'caravan';
    cityId: string;
    otherCityId?: string;
    magnitudeBps: number;
    startsAt: Date;
    endsAt: Date;
  },
) {
  await ensureInitialConfig(owner, INITIAL_CONFIG);
  return owner.transaction().execute(async (trx) => {
    const { rows } = await sql<{ day: number }>`select
      coalesce((select max(game_day) from game.daily_closes where world_id = ${event.worldId}), 0) + 1 as day`.execute(
      trx,
    );
    const day = rows[0]?.day ?? 1;
    await sql`alter table game.world_events disable trigger world_events_guard`.execute(trx);
    await sql`insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
      values (${event.worldId}, ${day}, now(), (select id from config.versions order by id limit 1))`.execute(
      trx,
    );
    // Jeu d'essai, pas code du jeu : la clé est contrôlée aussitôt, sur une clôture déjà posée.
    // eslint-disable-next-line no-restricted-syntax
    await sql`set constraints game.world_events_played_close immediate`.execute(trx);
    const { id } = await trx
      .insertInto('game.world_events')
      .values({
        world_id: event.worldId,
        model: event.model,
        city_id: event.cityId,
        other_city_id: event.otherCityId ?? null,
        good_id: null,
        planned_day: day,
        start_day: day + 1,
        end_day: day + 2,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        magnitude_bps: event.magnitudeBps,
        seed: '0'.repeat(64),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await sql`alter table game.world_events enable trigger world_events_guard`.execute(trx);
    return { eventId: id };
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

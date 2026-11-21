import { eventDaySeed } from '@oikos/engine';
import {
  cycleYield,
  dailyCloseAt,
  planWorldEvents,
  stormDurationSeconds,
  yieldDeltaBps,
  yieldModelOf,
} from '@oikos/sim';
import { sql } from 'kysely';
import { config, type City } from './city';

/*
 * Événements du monde joués par le banc (#668, docs/specs/07-dieux-faveur-evenements.md, 7.3 et 7.4). Le banc clôt
 * des jours passés, et la clôture ne planifie pas un jour dont le début est déjà atteint selon l'heure de la base :
 * il planifie donc lui-même, après chaque clôture, ce qu'elle aurait planifié, avec le tirage du jeu
 * (`planWorldEvents`, graine du monde et du jour par `eventDaySeed`), garde de la table coupée le temps de
 * l'écriture. Leurs effets sont ceux du jeu : la caravane est lue par le tick de demande au jour de jeu ; la
 * sécheresse et la bonne année touchent la récolte (`yieldOf`, `cycleYield` comme `site.collect`) ; la tempête allonge
 * le départ d'un voyage (`stormyDuration`, `stormDurationSeconds` comme `voyage.depart`), que le banc date de l'heure
 * de jeu. Les oracles ne sont pas écrits : rien du banc ne les lit.
 */

/** Événements que la clôture du jour `day` planifie : ceux qui commencent `planningLeadDays` jours plus tard. */
export async function planEvents(world: City, cities: readonly City[], day: number) {
  const rules = config.worldEvents;
  if (!rules) return [];
  const gameDay = world.firstDay + day;
  const startDay = gameDay + rules.planningLeadDays;
  const { seed } = await world.db
    .selectFrom('game.worlds')
    .select('seed')
    .where('id', '=', world.worldId)
    .executeTakeFirstOrThrow();
  const idOf = new Map(cities.map((city) => [city.slug, city.cityId]));
  const id = (slug: string) => {
    const found = idOf.get(slug);
    if (!found) throw new Error(`World event drawn on unknown city ${slug}`);
    return found;
  };
  const daySeed = eventDaySeed(seed, startDay);
  const planned = planWorldEvents({
    daySeed,
    startDay,
    models: rules.models,
    cities: [...idOf.keys()],
    routes: config.ships.routes
      .map((route) => route.cities)
      .filter((pair) => pair.every((slug) => idOf.has(slug))),
  });
  if (planned.length === 0) return [];
  // Garde coupée le temps de l'écriture, hors transaction : la clé de la clôture jouée, différée, est vérifiée à la
  // validation de chaque insertion, et la table ne se modifie pas avec un contrôle différé en attente.
  // La coupure vaut pour toute la table : deux parties jouées en même temps sur une base (simulateur, #904) se
  // sérialisent par un verrou consultatif, pris sur une seule connexion, sans quoi l'une rétablit la garde pendant
  // que l'autre écrit encore.
  await world.owner.connection().execute(async (conn) => {
    await sql`select pg_advisory_lock(hashtext('balance.world_events_guard'))`.execute(conn);
    try {
      await sql`alter table game.world_events disable trigger world_events_guard`.execute(conn);
      try {
        for (const event of planned)
          await conn
            .insertInto('game.world_events')
            .values({
              world_id: world.worldId,
              model: event.model,
              city_id: id(event.cityId),
              other_city_id: event.otherCityId === null ? null : id(event.otherCityId),
              good_id: event.goodId,
              planned_day: gameDay,
              start_day: event.startDay,
              end_day: event.endDay,
              starts_at: dailyCloseAt(event.startDay, config.clock),
              ends_at: dailyCloseAt(event.endDay, config.clock),
              magnitude_bps: event.magnitudeBps,
              seed: daySeed,
            })
            .execute();
      } finally {
        await sql`alter table game.world_events enable trigger world_events_guard`.execute(conn);
      }
    } finally {
      await sql`select pg_advisory_unlock(hashtext('balance.world_events_guard'))`.execute(conn);
    }
  });
  return planned;
}

/**
 * Quantité que rendent `cycles` cycles d'un site d'extrant `outputPerCycle`, le premier commencé à `since`, avec les
 * événements de rendement de sa cité (sécheresse des champs, bonne année des vergers) : `cycles × extrant` sans eux.
 */
export async function yieldOf(
  city: City,
  siteType: string,
  since: Date,
  input: { cycleMinutes: number; cycles: number; outputPerCycle: number },
) {
  const model = yieldModelOf(siteType);
  if (model === undefined || input.cycles === 0) return input.cycles * input.outputPerCycle;
  const until = new Date(since.getTime() + input.cycles * input.cycleMinutes * 60_000);
  const events = await city.db
    .selectFrom('game.world_events')
    .select(['id', 'starts_at', 'ends_at', 'magnitude_bps'])
    .where('city_id', '=', city.cityId)
    .where('model', '=', model)
    .where('ends_at', '>', since)
    .where('starts_at', '<=', until)
    .execute();
  return cycleYield({
    since,
    ...input,
    effects: events.map((event) => ({
      eventId: event.id,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      deltaBps: yieldDeltaBps(model, event.magnitude_bps),
    })),
  }).quantity;
}

/**
 * Durée en secondes d'un trajet de `seconds` secondes parti à `at` entre les cités `a` et `b` : allongée par la plus
 * forte tempête en cours de la route (à égalité, la planification la plus ancienne), comme `voyage.depart`.
 */
export async function stormyDuration(city: City, a: string, b: string, at: Date, seconds: number) {
  const storm = await city.db
    .selectFrom('game.world_events')
    .select('magnitude_bps')
    .where('world_id', '=', city.worldId)
    .where('model', '=', 'storm')
    .where((eb) =>
      eb.or([
        eb.and([eb('city_id', '=', a), eb('other_city_id', '=', b)]),
        eb.and([eb('city_id', '=', b), eb('other_city_id', '=', a)]),
      ]),
    )
    .where('starts_at', '<=', at)
    .where('ends_at', '>', at)
    .orderBy('magnitude_bps', 'desc')
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();
  return storm ? stormDurationSeconds(seconds, storm.magnitude_bps) : seconds;
}

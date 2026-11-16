import { createHash } from 'node:crypto';
import { dailyCloseAt, planWorldEvents } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Graine des événements d'un jour de jeu (13, #267) : SHA-256 de la graine du monde et du jour, en hexadécimal.
 * À sens unique : connaître la graine d'un jour, enregistrée avec ses événements, ne dit rien de celle du monde
 * ni de celle des autres jours.
 */
export function eventDaySeed(worldSeed: string, gameDay: number): string {
  if (!Number.isSafeInteger(gameDay)) throw new RangeError(`Invalid game day ${gameDay}`);
  return createHash('sha256').update(`${worldSeed}:${gameDay}`).digest('hex');
}

/**
 * Planification des événements du monde (7.3, 7.4 ; #267). La clôture qui ouvre le jour J planifie les événements
 * qui commencent au jour J + `worldEvents.planningLeadDays`, tirés par `planWorldEvents` de la graine de ce jour,
 * sur les cités du monde connues de la configuration et les routes entre elles. Chaque événement commence à la
 * clôture qui ouvre son premier jour et finit à celle qui ouvre le jour qui le suit. Sans section, ou sans modèle
 * à probabilité non nulle, l'étape ne lit rien. Une clôture jouée en retard ne planifie pas un jour dont le début
 * est déjà atteint selon l'heure de la base (`now()` de sa transaction, celle de la garde) : ses événements sont
 * manqués, et le reste de la clôture se joue. Elle ne prend aucun verrou : la clôture tient celui de son monde,
 * que la garde de la base reprend. Un événement déjà planifié pour ce modèle et ce jour (étape rejouée, délai
 * raccourci entre deux clôtures) n'est pas planifié une seconde fois. Le résumé a toujours la même forme ; son
 * jour planifié est nul sans section.
 */
export const worldEventPlanning: CloseStep = {
  name: 'worldEventPlanning',
  async run({ trx, worldId, gameDay, config }) {
    const rules = config.worldEvents;
    const none = (startDay: number | null) => ({ startDay, planned: 0, models: [] as string[] });
    if (!rules) return none(null);
    const startDay = gameDay + rules.planningLeadDays;
    if (!Object.values(rules.models).some((model) => (model?.probabilityBps ?? 0) > 0))
      return none(startDay);
    const startsAt = dailyCloseAt(startDay, config.clock);
    // Comparé dans la base, à l'instant de la transaction : la garde refuse `starts_at <= now()`.
    const { rows } = await sql<{
      reached: boolean;
    }>`select now() >= ${startsAt}::timestamptz as reached`.execute(trx);
    if (rows[0]?.reached !== false) return none(startDay);
    const world = await trx
      .selectFrom('game.worlds')
      .select('seed')
      .where('id', '=', worldId)
      .executeTakeFirstOrThrow();
    const cities = await trx
      .selectFrom('game.cities')
      .select(['id', 'slug'])
      .where('world_id', '=', worldId)
      .execute();
    const idOf = new Map(
      cities
        .filter((city) => config.cities.some((known) => known.id === city.slug))
        .map((city) => [city.slug, city.id]),
    );
    const cityId = (slug: string) => {
      const id = idOf.get(slug);
      if (id === undefined) throw new Error(`World event drawn on unknown city ${slug}`);
      return id;
    };
    const daySeed = eventDaySeed(world.seed, startDay);
    const planned = planWorldEvents({
      daySeed,
      startDay,
      models: rules.models,
      cities: [...idOf.keys()],
      routes: config.ships.routes
        .map((route) => route.cities)
        .filter((pair) => pair.every((slug) => idOf.has(slug))),
    });
    const inserted: string[] = [];
    for (const event of planned) {
      const row = await trx
        .insertInto('game.world_events')
        .values({
          world_id: worldId,
          model: event.model,
          city_id: cityId(event.cityId),
          other_city_id: event.otherCityId === null ? null : cityId(event.otherCityId),
          good_id: event.goodId,
          planned_day: gameDay,
          start_day: event.startDay,
          end_day: event.endDay,
          starts_at: dailyCloseAt(event.startDay, config.clock),
          ends_at: dailyCloseAt(event.endDay, config.clock),
          magnitude_bps: event.magnitudeBps,
          seed: daySeed,
        })
        .onConflict((conflict) => conflict.constraint('world_events_once').doNothing())
        .returning('model')
        .executeTakeFirst();
      if (row) inserted.push(row.model);
    }
    return { startDay, planned: inserted.length, models: inserted };
  },
};

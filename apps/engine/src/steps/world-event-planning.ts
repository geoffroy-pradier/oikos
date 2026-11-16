import { createHash } from 'node:crypto';
import { dailyCloseAt, planWorldEvents } from '@oikos/sim';
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
 * à probabilité non nulle, l'étape ne lit rien. Elle ne prend aucun verrou : la clôture tient celui de son monde,
 * que la garde de la base reprend. Un événement déjà planifié pour ce modèle et ce jour (étape rejouée, délai
 * raccourci entre deux clôtures) n'est pas planifié une seconde fois.
 */
export const worldEventPlanning: CloseStep = {
  name: 'worldEventPlanning',
  async run({ trx, worldId, gameDay, config }) {
    const rules = config.worldEvents;
    if (!rules || !Object.values(rules.models).some((model) => (model?.probabilityBps ?? 0) > 0))
      return { planned: 0 };
    const startDay = gameDay + rules.planningLeadDays;
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
          city_id: idOf.get(event.cityId) ?? '',
          other_city_id: event.otherCityId === null ? null : (idOf.get(event.otherCityId) ?? ''),
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

import { domainEventSchema, type DomainEventType } from '@oikos/contracts';
import type { Db } from '@oikos/db';
import {
  dailyCloseAt,
  type ChronicleInputEvent,
  type ChronicleWorldEvent,
  type DayClock,
} from '@oikos/sim';
import { sql } from 'kysely';
import { z } from 'zod';

const TYPES: DomainEventType[] = [
  'TradeExecuted',
  'VoyageArrived',
  'ArchonElected',
  'DecreeAdopted',
  'DecreeRejected',
  'DecreeApplied',
  'DecreeLapsed',
];
// Ce que l'étape de population écrit au journal de la clôture : avant et après, par classe et par cité. Un journal
// illisible (un nombre négatif ou non entier compris) ne dit rien de la population : il ne bloque pas le monde.
const people = z.number().int().nonnegative().max(100_000_000);
const populationSummary = z.object({
  npcPopulation: z.object({
    classes: z.array(z.object({ city: z.string(), before: people, after: people })),
  }),
});

export interface ChronicleClose {
  game_day: number;
  close_at: Date;
  finished_at: Date;
  config_version_id: string;
  summary: unknown;
}

export interface ChronicleDay {
  /** Événements de domaine de la journée, toutes cités du monde, dans leur ordre d'émission. */
  events: ChronicleInputEvent[];
  /** Événements du monde commencés pendant la journée. */
  worldEvents: ChronicleWorldEvent[];
  /** Habitants d'une cité avant et après la clôture, `null` si la clôture n'en a rien dit. */
  population: (citySlug: string) => { before: number; after: number } | null;
}

/**
 * Ce qui s'est passé dans un monde depuis la clôture précédente jusqu'à `close`, résultats de celle-ci compris
 * (#271) : les événements de domaine des cités du monde écrits entre la fin des deux clôtures, les événements du
 * monde commencés depuis le jour de la précédente, le changement de version de configuration entre les deux
 * clôtures, et la population du journal de la clôture. Sans clôture précédente (monde neuf), la journée qui
 * précède, sans changement de configuration. Les cités sont désignées par leur identifiant court.
 */
export async function readChronicleDay(
  trx: Db,
  worldId: string,
  close: ChronicleClose,
  cities: readonly { id: string; slug: string }[],
  clock: DayClock,
): Promise<ChronicleDay> {
  const previous = await trx
    .selectFrom('game.daily_closes')
    .select(['game_day', 'close_at', 'finished_at', 'config_version_id'])
    .where('world_id', '=', worldId)
    .where('game_day', '<', close.game_day)
    .orderBy('game_day', 'desc')
    .limit(1)
    .executeTakeFirst();
  // Sans clôture précédente (monde neuf), la journée qui précède celle-ci.
  const fromDay = previous?.game_day ?? close.game_day - 1;
  const from = previous?.finished_at ?? dailyCloseAt(fromDay, clock);
  const slugs = new Map(cities.map((city) => [city.id, city.slug]));
  const slug = (id: string) => slugs.get(id) ?? '';

  const read = await trx
    .selectFrom('game.domain_events')
    .select(['type', 'payload', 'created_at'])
    .where('type', 'in', TYPES)
    // Les seules cités du monde, lues dans la base : celle de l'événement, ou l'arrivée d'un voyage.
    .where(
      sql<boolean>`coalesce(payload ->> 'cityId', payload ->> 'toCityId') = any(${[...slugs.keys()]}::text[])`,
    )
    .where('created_at', '>=', from)
    .where('created_at', '<', close.finished_at)
    .orderBy('seq')
    .execute();
  const events = read.flatMap(({ type, payload, created_at: at }) => {
    const parsed = domainEventSchema.safeParse({ type, payload });
    return parsed.success ? [{ ...parsed.data, at }] : [];
  });
  const electedIds = events.flatMap((e) => (e.type === 'ArchonElected' ? [e.payload.houseId] : []));
  const houses = new Map(
    electedIds.length === 0
      ? []
      : (
          await trx
            .selectFrom('game.houses')
            .select(['id', 'name'])
            .where('world_id', '=', worldId)
            .where('id', 'in', electedIds)
            .execute()
        ).map((house) => [house.id, house.name]),
  );
  const input = events.flatMap((event): ChronicleInputEvent[] => {
    switch (event.type) {
      case 'TradeExecuted': {
        const { cityId, goodId, price, quantity } = event.payload;
        return [{ type: 'trade', cityId: slug(cityId), goodId, price, quantity }];
      }
      case 'VoyageArrived': {
        const { toCityId, fromCityId } = event.payload;
        return [{ type: 'arrival', cityId: slug(toCityId), fromCityId: slug(fromCityId) }];
      }
      case 'ArchonElected': {
        const { cityId, houseId, votes } = event.payload;
        // Introuvable : sans nom, la chronique ne la nomme pas.
        const houseName = houses.get(houseId) ?? '';
        return [{ type: 'election', cityId: slug(cityId), houseName, votes }];
      }
      case 'DecreeAdopted':
      case 'DecreeRejected': {
        const outcome = event.type === 'DecreeAdopted' ? 'adopted' : 'rejected';
        const { cityId, model, votesFor, votesAgainst } = event.payload;
        return [{ type: 'decree', cityId: slug(cityId), model, outcome, votesFor, votesAgainst }];
      }
      case 'DecreeApplied':
      case 'DecreeLapsed': {
        const outcome = event.type === 'DecreeApplied' ? 'applied' : 'lapsed';
        const { cityId, decree } = event.payload;
        return [{ type: 'decree', cityId: slug(cityId), model: decree.model, outcome }];
      }
      default:
        return [];
    }
  });
  // La version que la clôture a lue n'est plus celle de la précédente : une nouvelle version entre en vigueur.
  // Une programmation annulée, ou qui remet la même version, ne change rien et n'est pas annoncée.
  if (previous && previous.config_version_id !== close.config_version_id)
    input.push({ type: 'configScheduled', activateAt: close.close_at.getTime() });
  const worldEvents: ChronicleWorldEvent[] = (
    await trx
      .selectFrom('game.world_events')
      .select(['model', 'city_id', 'other_city_id', 'good_id'])
      .where('world_id', '=', worldId)
      .where('start_day', '>', fromDay)
      .where('start_day', '<=', close.game_day)
      .execute()
  ).map((event) => ({
    model: event.model,
    cityId: slug(event.city_id),
    otherCityId: event.other_city_id === null ? null : slug(event.other_city_id),
    goodId: event.good_id,
  }));
  const summary = populationSummary.safeParse(close.summary);
  const classes = summary.success ? summary.data.npcPopulation.classes : [];
  const population = (citySlug: string) => {
    const own = classes.filter((row) => row.city === citySlug);
    const sum = (key: 'before' | 'after') => own.reduce((total, row) => total + row[key], 0);
    return own.length > 0 ? { before: sum('before'), after: sum('after') } : null;
  };
  return { events: input, worldEvents, population };
}

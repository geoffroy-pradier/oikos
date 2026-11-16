import { createGateway, type AiCallStore, type AiProvider } from '@oikos/ai';
import type { ConfigLoader } from '@oikos/config';
import type { Db } from '@oikos/db';
import { chronicleFacts } from '@oikos/sim';
import { sql } from 'kysely';
import { composeChronicle } from './compose';
import { readChronicleDay } from './day';
import { chronicleRewriteRequest } from './rewrite';

export interface ChronicleRequest {
  now: Date;
  config: Pick<ConfigLoader, 'at'>;
  /** Fournisseur et journal de la passerelle IA (ADR 0005). */
  provider: AiProvider;
  store: AiCallStore;
}

/**
 * Chronique des cités d'un monde à sa dernière clôture (6.6, 8.1, 15.2 ; #271) : une par cité, composée par les
 * gabarits à partir des faits de la journée (`readChronicleDay`), puis réécrite par la passerelle IA (usage
 * `chronicle`). Elle n'est écrite que `chronicle.settleSeconds` après la fin de la clôture, pour qu'une commande
 * commencée avant cette fin soit validée. Une transaction courte lit la journée et compose les brouillons ; les
 * appels à l'IA se font hors de toute transaction ; une seule instruction insère les chroniques, sans doublon. Deux
 * moteurs ne la préparent pas ensemble : un verrou consultatif de session, sur une connexion dédiée, est essayé
 * sans attendre (l'autre passe son tour) et rendu à la fin, même en échec ; une connexion perdue le rend aussi.
 * Seule la dernière clôture a sa chronique : une chronique manquée n'est pas rattrapée. Rend le nombre de chroniques
 * réellement insérées.
 */
export async function writeChronicles(
  db: Db,
  worldId: string,
  request: ChronicleRequest,
): Promise<number> {
  const { config } = await request.config.at(request.now);
  const close = await db
    .selectFrom('game.daily_closes')
    .select(['game_day', 'close_at', 'finished_at', 'config_version_id', 'summary'])
    .where('world_id', '=', worldId)
    .orderBy('game_day', 'desc')
    .limit(1)
    .executeTakeFirst();
  const settled =
    (close?.finished_at.getTime() ?? Infinity) + config.chronicle.settleSeconds * 1000;
  if (!close || request.now.getTime() < settled) return 0;

  const lock = sql`hashtextextended(${`chronicle:${worldId}`}, 0)`;
  return db.connection().execute(async (conn) => {
    const { rows } = await sql<{ locked: boolean }>`
      select pg_try_advisory_lock(${lock}) as locked
    `.execute(conn);
    if (rows[0]?.locked !== true) return 0;
    try {
      const drafts = await conn.transaction().execute(async (trx) => {
        const cities = await trx
          .selectFrom('game.cities')
          .select(['id', 'slug', 'name'])
          .where('world_id', '=', worldId)
          .orderBy('slug')
          .execute();
        const done = await trx
          .selectFrom('game.chronicle_articles')
          .select('city_id')
          .where('world_id', '=', worldId)
          .where('game_day', '=', close.game_day)
          .execute();
        const pending = cities.filter((city) => !done.some((row) => row.city_id === city.id));
        if (pending.length === 0) return [];
        const day = await readChronicleDay(trx, worldId, close, cities, config.clock);
        const cityNames = new Map(cities.map((city) => [city.slug, city.name]));
        return pending.map((city) => {
          const facts = chronicleFacts({
            cityId: city.slug,
            events: day.events,
            worldEvents: day.worldEvents,
            population: day.population(city.slug),
            maxGoods: config.chronicle.maxGoods,
          });
          const context = { citySlug: city.slug, cityNames };
          return { cityId: city.id, facts, context, draft: composeChronicle(facts, context) };
        });
      });
      if (drafts.length === 0) return 0;

      const gateway = createGateway({
        provider: request.provider,
        store: request.store,
        settings: () => config.ai,
      });
      const articles = [];
      for (const { cityId, facts, context, draft } of drafts) {
        const { maxTextLength } = config.chronicle;
        const rewritten = await gateway(
          chronicleRewriteRequest(facts, draft, context, maxTextLength),
        );
        articles.push({
          world_id: worldId,
          city_id: cityId,
          game_day: close.game_day,
          facts: JSON.stringify(facts),
          text_fr: rewritten.value.fr,
          text_en: rewritten.value.en,
          source: rewritten.source,
        });
      }
      const inserted = await conn
        .insertInto('game.chronicle_articles')
        .values(articles)
        .onConflict((conflict) => conflict.columns(['city_id', 'game_day']).doNothing())
        .returning('id')
        .execute();
      return inserted.length;
    } finally {
      await sql`select pg_advisory_unlock(${lock})`.execute(conn);
    }
  });
}

/** Chroniques de tous les mondes ; l'échec d'un monde n'arrête pas les autres et il est rapporté. */
export async function writeAllChronicles(db: Db, request: ChronicleRequest) {
  const worlds = await db.selectFrom('game.worlds').select('id').orderBy('id').execute();
  const results: { worldId: string; written: number; error?: string }[] = [];
  for (const { id: worldId } of worlds) {
    try {
      results.push({ worldId, written: await writeChronicles(db, worldId, request) });
    } catch (error) {
      console.error(`World ${worldId}: chronicle failed`, error);
      const message = error instanceof Error ? error.message : String(error);
      results.push({ worldId, written: 0, error: message });
    }
  }
  return results;
}

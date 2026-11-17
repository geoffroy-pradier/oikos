import { createGateway, type AiCallStore, type AiProvider } from '@oikos/ai';
import type { ConfigLoader } from '@oikos/config';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import { oracleCityNames } from './check';
import { oracleRewriteRequest } from './rewrite';

export interface OracleTaskRequest {
  now: Date;
  config: Pick<ConfigLoader, 'at'>;
  /** Fournisseur et journal de la passerelle IA (ADR 0005). */
  provider: AiProvider;
  store: AiCallStore;
}

/**
 * Réécriture des oracles d'un monde par la passerelle IA (usage `oracle`, 7.3, 8.4 ; #270), par lots après chaque
 * clôture, comme la chronique. Chaque oracle encore en repli d'un événement qui n'a pas commencé est essayé une fois :
 * réécrit dans les deux langues si la sortie est conforme (`oracleRewriteRequest`), sinon le repli reste ; l'issue
 * est notée, si bien qu'aucun oracle n'est payé deux fois au fournisseur. IA coupée, ou version sans Pythie, rien
 * n'est lu ni essayé : les oracles de repli suffisent au jeu, et ceux d'événements encore à venir seront essayés si
 * l'usage est rallumé. Les appels se font hors de toute transaction ; chaque oracle est écrit par sa propre
 * instruction, qui ne touche qu'un oracle jamais essayé d'un événement encore à venir. Deux moteurs ne travaillent
 * pas ensemble : verrou consultatif de session, essayé sans attendre et rendu à la fin, comme pour la chronique.
 * Rend le nombre d'oracles essayés et réécrits.
 */
export async function rewriteOracles(db: Db, worldId: string, request: OracleTaskRequest) {
  const none = { attempted: 0, rewritten: 0 };
  const { config } = await request.config.at(request.now);
  if (!config.oracle || !config.ai.usages.oracle.enabled) return none;
  const { maxTextLength } = config.oracle;

  const lock = sql`hashtextextended(${`oracle:${worldId}`}, 0)`;
  return db.connection().execute(async (conn) => {
    const { rows } = await sql<{ locked: boolean }>`
      select pg_try_advisory_lock(${lock}) as locked
    `.execute(conn);
    if (rows[0]?.locked !== true) return none;
    try {
      const pending = await conn
        .selectFrom('game.oracles as o')
        .innerJoin('game.world_events as e', 'e.id', 'o.event_id')
        .select(['o.id', 'o.text_fr', 'o.text_en', 'e.model', 'e.good_id'])
        .where('o.world_id', '=', worldId)
        .where('o.rewritten_at', 'is', null)
        .where('e.starts_at', '>', sql<Date>`now()`)
        .orderBy('e.starts_at')
        .orderBy('o.id')
        .execute();
      if (pending.length === 0) return none;
      const cities = await conn
        .selectFrom('game.cities')
        .select(['slug', 'name'])
        .where('world_id', '=', worldId)
        .execute();
      const names = oracleCityNames(cities);
      const gateway = createGateway({
        provider: request.provider,
        store: request.store,
        settings: () => config.ai,
      });
      const done = { ...none };
      for (const oracle of pending) {
        const event = { model: oracle.model, goodId: oracle.good_id };
        const draft = { fr: oracle.text_fr, en: oracle.text_en };
        const result = await gateway(oracleRewriteRequest(event, draft, names, maxTextLength));
        // Usage coupé entre-temps : rien n'a été essayé.
        if (result.outcome === 'disabled') continue;
        const texts =
          result.source === 'ai'
            ? { text_fr: result.value.fr, text_en: result.value.en, source: 'ai' as const }
            : {};
        const updated = await conn
          .updateTable('game.oracles')
          .set({ ...texts, rewritten_at: sql<Date>`now()`, rewrite_outcome: result.outcome })
          .where('id', '=', oracle.id)
          .where('rewritten_at', 'is', null)
          .where(({ exists, selectFrom }) =>
            exists(
              selectFrom('game.world_events as e')
                .select('e.id')
                .whereRef('e.id', '=', 'game.oracles.event_id')
                .where('e.starts_at', '>', sql<Date>`now()`),
            ),
          )
          .executeTakeFirst();
        if (updated.numUpdatedRows === 0n) continue;
        done.attempted += 1;
        if (result.source === 'ai') done.rewritten += 1;
      }
      return done;
    } finally {
      await sql`select pg_advisory_unlock(${lock})`.execute(conn);
    }
  });
}

/** Oracles de tous les mondes ; l'échec d'un monde n'arrête pas les autres et il est rapporté. */
export async function rewriteAllOracles(db: Db, request: OracleTaskRequest) {
  const worlds = await db.selectFrom('game.worlds').select('id').orderBy('id').execute();
  const results: { worldId: string; attempted: number; rewritten: number; error?: string }[] = [];
  for (const { id: worldId } of worlds) {
    try {
      results.push({ worldId, ...(await rewriteOracles(db, worldId, request)) });
    } catch (error) {
      console.error(`World ${worldId}: oracle rewrite failed`, error);
      const message = error instanceof Error ? error.message : String(error);
      results.push({ worldId, attempted: 0, rewritten: 0, error: message });
    }
  }
  return results;
}

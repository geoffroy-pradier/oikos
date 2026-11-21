import { createGateway, type AiCallStore, type AiProvider } from '@oikos/ai';
import type { ConfigLoader } from '@oikos/config';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import { triageRequest } from './triage';

export interface TriageTaskRequest {
  now: Date;
  config: Pick<ConfigLoader, 'at'>;
  /** Fournisseur et journal de la passerelle IA (ADR 0005). */
  provider: AiProvider;
  store: AiCallStore;
}

/**
 * Pré-tri des messages signalés d'un monde par la passerelle IA (usage `moderation_triage`, 8.1, 15.1 ; #763). Chaque
 * message qui a un signalement ouvert et pas encore de ligne dans `game.report_triage` est essayé une fois (un plafond atteint n'est pas un essai : le message est repris plus tard), le plus
 * ancien signalement d'abord : rangé dans une catégorie avec son résumé si la sortie est conforme
 * (`triageRequest`), sinon sans catégorie ; l'issue est notée dans les deux cas, si bien qu'aucun message n'est payé
 * deux fois au fournisseur. IA coupée, rien n'est lu ni essayé : la file garde son ordre de la phase 2, et les messages
 * seront essayés si l'usage est rallumé. Les appels se font hors de toute transaction. Le modèle n'écrit rien : le
 * moteur écrit, sous le rôle de service, ce que le schéma a accepté, dans une instruction qui ne touche qu'un message
 * encore signalé et jamais essayé. Deux moteurs ne travaillent pas ensemble : verrou consultatif de session, essayé sans
 * attendre et rendu à la fin, comme pour les oracles. Rend le nombre de messages essayés et rangés.
 */
export async function triageReports(db: Db, worldId: string, request: TriageTaskRequest) {
  const none = { attempted: 0, categorized: 0 };
  const { config } = await request.config.at(request.now);
  if (!config.ai.usages.moderation_triage.enabled) return none;
  const maxSummaryLength = config.moderation.triageSummaryMaxLength;

  const lock = sql`hashtextextended(${`moderation-triage:${worldId}`}, 0)`;
  return db.connection().execute(async (conn) => {
    const { rows } = await sql<{ locked: boolean }>`
      select pg_try_advisory_lock(${lock}) as locked
    `.execute(conn);
    if (rows[0]?.locked !== true) return none;
    try {
      const pending = await conn
        .selectFrom('game.messages as m')
        .innerJoin('game.houses as h', 'h.id', 'm.house_id')
        .select(['m.id', 'm.body', 'h.name as house_name'])
        .where('h.world_id', '=', worldId)
        .where(({ exists, selectFrom }) =>
          exists(
            selectFrom('game.reports as r')
              .select('r.id')
              .whereRef('r.message_id', '=', 'm.id')
              .where('r.state', '=', 'open'),
          ),
        )
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('game.report_triage as t')
                .select('t.message_id')
                .whereRef('t.message_id', '=', 'm.id'),
            ),
          ),
        )
        .orderBy(
          sql`(select min(r.created_at) from game.reports r where r.message_id = m.id and r.state = 'open')`,
        )
        .orderBy('m.id')
        .execute();
      if (pending.length === 0) return none;
      const houses = await conn
        .selectFrom('game.houses')
        .select('name')
        .where('world_id', '=', worldId)
        .execute();
      const houseNames = houses.map((house) => house.name);
      // Réglages relus avant chaque message : un usage coupé entre-temps n'essaie plus rien.
      let ai = config.ai;
      const gateway = createGateway({
        provider: request.provider,
        store: request.store,
        settings: () => ai,
      });
      const done = { ...none };
      for (const message of pending) {
        ai = (await request.config.at(request.now)).config.ai;
        const result = await gateway(
          triageRequest(
            { houseName: message.house_name, body: message.body },
            houseNames,
            maxSummaryLength,
          ),
        );
        // Usage coupé entre-temps : rien n'a été essayé.
        if (result.outcome === 'disabled') continue;
        // Plafond du mois atteint : aucun appel n'est parti ni n'a été payé. Aucune ligne n'est écrite, le message
        // sera repris au passage suivant, après la remise à zéro du mois ou une hausse du plafond. Les autres
        // messages seraient coupés de même : le passage s'arrête.
        if (result.outcome === 'capped') break;
        const triage = result.source === 'ai' ? result.value : null;
        // Le message a pu être purgé pendant l'appel : alors rien n'est écrit.
        const inserted = await conn
          .insertInto('game.report_triage')
          .columns(['message_id', 'category', 'summary', 'outcome'])
          .expression(
            sql`select m.id, ${triage?.category ?? null}, ${triage?.summary ?? null}, ${triage ? 'ok' : result.outcome}
                from game.messages m where m.id = ${message.id}`,
          )
          .onConflict((conflict) => conflict.column('message_id').doNothing())
          .executeTakeFirst();
        if (inserted.numInsertedOrUpdatedRows === 0n) continue;
        done.attempted += 1;
        if (triage) done.categorized += 1;
      }
      return done;
    } finally {
      await sql`select pg_advisory_unlock(${lock})`.execute(conn);
    }
  });
}

/** Messages signalés de tous les mondes ; l'échec d'un monde n'arrête pas les autres et il est rapporté. */
export async function triageAllReports(db: Db, request: TriageTaskRequest) {
  const worlds = await db.selectFrom('game.worlds').select('id').orderBy('id').execute();
  const results: { worldId: string; attempted: number; categorized: number; error?: string }[] = [];
  for (const { id: worldId } of worlds) {
    try {
      results.push({ worldId, ...(await triageReports(db, worldId, request)) });
    } catch (error) {
      console.error(`World ${worldId}: report triage failed`, error);
      const message = error instanceof Error ? error.message : String(error);
      results.push({ worldId, attempted: 0, categorized: 0, error: message });
    }
  }
  return results;
}

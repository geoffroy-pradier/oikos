import { createGateway, type AiCallStore, type AiProvider } from '@oikos/ai';
import { stewardRulesLimit, type ConfigLoader } from '@oikos/config';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import { simulateRules } from './simulate';
import {
  refusalBeforeCall,
  stewardSite,
  translationOf,
  translationRequest,
  type Translation,
} from './translate';

export interface StewardInstructionTaskRequest {
  now: Date;
  config: Pick<ConfigLoader, 'at'>;
  /** Fournisseur et journal de la passerelle IA (ADR 0005). */
  provider: AiProvider;
  store: AiCallStore;
}

/**
 * Réponse aux consignes d'intendant d'un monde (4.4, 8.1, 8.4 ; #280), dans leur ordre d'arrivée, sous la
 * configuration en vigueur. Chaque consigne en attente d'un intendant en poste est traduite une fois par la passerelle
 * (usage `steward`), hors de toute transaction, puis ses règles sont simulées à blanc ; la proposition, ou le refus
 * motivé, est écrite avec la réponse de la consigne dans une transaction. IA coupée, plafond atteint ou panne : refus
 * `AI_UNAVAILABLE`, et l'écran ouvre le formulaire ; texte effacé, le même, et nombres ambigus, `AMBIGUOUS`, sans
 * appel. Rien n'est donné à l'intendant : le joueur valide par `steward.setRules`. Deux moteurs ne travaillent pas
 * ensemble : verrou de session essayé sans attendre ; la base n'admet qu'une réponse par consigne. Rend le nombre de
 * consignes répondues, et de propositions de règles.
 */
export async function answerStewardInstructions(
  db: Db,
  worldId: string,
  request: StewardInstructionTaskRequest,
) {
  const done = { answered: 0, proposed: 0 };
  const lock = sql`hashtextextended(${`steward-instructions:${worldId}`}, 0)`;
  return db.connection().execute(async (conn) => {
    const { rows } = await sql<{ locked: boolean }>`
      select pg_try_advisory_lock(${lock}) as locked
    `.execute(conn);
    if (rows[0]?.locked !== true) return done;
    try {
      const pending = await conn
        .selectFrom('game.steward_instructions as i')
        .innerJoin('game.stewards as s', 's.id', 'i.steward_id')
        .innerJoin('game.sites as t', 't.id', 's.site_id')
        .select(['i.id', 'i.text', 's.world_id', 's.house_id', 's.site_id', 't.recipe_id'])
        .where('s.world_id', '=', worldId)
        .where('s.dismissed_at', 'is', null)
        .where('i.status', '=', 'pending')
        .orderBy('i.created_at')
        .orderBy('i.id')
        .execute();
      if (pending.length === 0) return done;
      const { config } = await request.config.at(request.now);
      const gateway = createGateway({
        provider: request.provider,
        store: request.store,
        settings: () => config.ai,
      });
      for (const instruction of pending) {
        const site = stewardSite(config, instruction.recipe_id, stewardRulesLimit(config));
        const text = site.maxRules === 0 ? null : instruction.text;
        const early = text === null ? 'AI_UNAVAILABLE' : refusalBeforeCall(text);
        const translation: Translation =
          text === null || early !== null
            ? { refusal: early ?? 'AI_UNAVAILABLE' }
            : translationOf(await gateway(translationRequest(text, site)));
        let simulation: unknown = null;
        if ('rules' in translation)
          simulation = await simulateRules(db, config, instruction, translation.rules).catch(
            (error: unknown) => {
              console.error(`Instruction ${instruction.id}: simulation failed`, error);
              return null;
            },
          );
        try {
          await db.transaction().execute(async (trx) => {
            await trx
              .insertInto('game.steward_proposals')
              .values({
                instruction_id: instruction.id,
                rules: 'rules' in translation ? JSON.stringify(translation.rules) : null,
                simulation: simulation === null ? null : JSON.stringify(simulation),
                refusal: 'refusal' in translation ? translation.refusal : null,
              })
              .execute();
            await trx
              .updateTable('game.steward_instructions')
              .set({ status: 'answered' })
              .where('id', '=', instruction.id)
              .execute();
          });
        } catch (error) {
          // Intendant renvoyé entre-temps, ou consigne déjà répondue : la base refuse, rien n'est écrit.
          console.error(`Instruction ${instruction.id}: answer not recorded`, error);
          continue;
        }
        done.answered += 1;
        if ('rules' in translation) done.proposed += 1;
      }
      return done;
    } finally {
      await sql`select pg_advisory_unlock(${lock})`.execute(conn);
    }
  });
}

/** Consignes de tous les mondes ; l'échec d'un monde n'arrête pas les autres et il est rapporté. */
export async function answerAllStewardInstructions(db: Db, request: StewardInstructionTaskRequest) {
  const worlds = await db.selectFrom('game.worlds').select('id').orderBy('id').execute();
  const results: { worldId: string; answered: number; proposed: number; error?: string }[] = [];
  for (const { id: worldId } of worlds) {
    try {
      results.push({ worldId, ...(await answerStewardInstructions(db, worldId, request)) });
    } catch (error) {
      console.error(`World ${worldId}: steward instructions failed`, error);
      const message = error instanceof Error ? error.message : String(error);
      results.push({ worldId, answered: 0, proposed: 0, error: message });
    }
  }
  return results;
}

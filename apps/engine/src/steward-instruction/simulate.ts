import type { GameConfig } from '@oikos/config';
import {
  domainEventSchema,
  MAX_ORDER_QUANTITY,
  stewardOperationSummarySchema,
  type StewardRule,
  type StewardSimulationStep,
} from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { ruleAction } from '@oikos/sim';
import { sql } from 'kysely';
import { sightOf } from '../steward-plan';
import { perform } from '../stewards';

/** L'intendant dont on simule les règles proposées : sa maison, son site et leur monde. */
export interface SimulatedSteward {
  world_id: string;
  house_id: string;
  site_id: string;
}

/**
 * Simulation à blanc des règles proposées (4.4, 8.1 ; #280) : ce que chacune ferait maintenant, sur l'état présent du
 * site et des stocks de la maison, menée une fois, dans l'ordre des règles, par le cœur de la commande du joueur
 * (ADR 0009) avec la configuration donnée. Les effets d'une règle qui réussit restent visibles aux suivantes (une
 * récolte, puis la vente de ce qu'elle a produit) ; ceux d'une règle refusée sont annulés, comme pour l'opération du
 * moteur. Rien n'est écrit : la transaction est toujours annulée, journal, événements et opérations compris. Les
 * verrous sont ceux de l'opération du moteur, dans le même ordre (agora du monde, trésorerie de la maison, puis ceux du
 * cœur) ; une panne lève, et l'appelant enregistre la proposition sans simulation.
 */
export async function simulateRules(
  db: Db,
  config: GameConfig,
  steward: SimulatedSteward,
  rules: readonly StewardRule[],
): Promise<StewardSimulationStep[]> {
  const trx = await db.startTransaction().setIsolationLevel('read committed').execute();
  try {
    const clock = await sql<{ now: Date }>`select now() as now`.execute(trx);
    const now = clock.rows[0]?.now;
    if (!now) throw new Error('The database returned no clock');
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${steward.world_id}`}, 0))`.execute(
      trx,
    );
    await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('house_id', '=', steward.house_id)
      .where('kind', '=', 'house')
      .forUpdate()
      .execute();
    const steps: StewardSimulationStep[] = [];
    for (const [position, rule] of rules.entries()) {
      const { sight, cityId } = await sightOf(trx, config, steward, rules, now);
      const action = ruleAction(rule, sight, MAX_ORDER_QUANTITY);
      if (!action) {
        steps.push({ position, status: 'idle' });
        continue;
      }
      const effects = await trx.savepoint('rule').execute();
      const context = {
        trx: effects,
        emit: (event: unknown) => void domainEventSchema.parse(event),
        config,
        now,
      };
      const { result, summary } = await perform(context, steward, cityId, action);
      const checked = stewardOperationSummarySchema.parse(summary);
      if (result.ok) {
        await effects.releaseSavepoint('rule').execute();
        steps.push({ position, status: 'ok', summary: checked });
      } else {
        await effects.rollbackToSavepoint('rule').execute();
        steps.push({ position, status: 'rejected', code: result.error.code, summary: checked });
      }
    }
    return steps;
  } finally {
    await trx.rollback().execute();
  }
}

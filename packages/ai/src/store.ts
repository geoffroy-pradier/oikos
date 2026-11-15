import type { AiUsage } from '@oikos/config/schema';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import type { AiCallStore } from './gateway';

/**
 * Journal des appels en base (`telemetry.ai_calls`, migration 50). La dépense du mois est la somme des
 * coûts estimés de l'usage depuis le premier jour du mois civil UTC qui contient `at`.
 */
export function dbCallStore(db: Db): AiCallStore {
  return {
    async spentThisMonth(usage: AiUsage, at: Date) {
      const { rows } = await sql<{ spent: string | null }>`
        select sum(cost_micro_euros) as spent from telemetry.ai_calls
        where usage = ${usage}
          and called_at >= date_trunc('month', ${at}::timestamptz at time zone 'UTC') at time zone 'UTC'
          and called_at < (date_trunc('month', ${at}::timestamptz at time zone 'UTC') + interval '1 month')
            at time zone 'UTC'`.execute(db);
      return Number(rows[0]?.spent ?? 0);
    },
    async record(call) {
      await db
        .insertInto('telemetry.ai_calls')
        .values({
          usage: call.usage,
          model: call.model,
          input_tokens: call.inputTokens,
          output_tokens: call.outputTokens,
          cost_micro_euros: call.costMicroEuros,
          outcome: call.outcome,
          duration_ms: call.durationMs,
          called_at: call.at,
        })
        .execute();
    },
  };
}

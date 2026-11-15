import { estimateCostMicroEuros } from '@oikos/ai';
import { AI_USAGES, aiMonthlyCapMicroEuros, type AiUsage, type GameConfig } from '@oikos/config';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';

/** Une ligne de la Vigie par usage de l'IA (8.5, ADR 0005). Montants en millionièmes d'euro. */
export interface AiUsageFigures {
  usage: AiUsage;
  /** `disabled` : coupé par la configuration ; `capped` : plafond du mois atteint ; `null` : ouvert. */
  cut: 'disabled' | 'capped' | null;
  capMicroEuros: number;
  spentTodayMicroEuros: number;
  spentMonthMicroEuros: number;
  /** Réponses reçues ce mois-ci (acceptées ou rejetées), dont rejetées par le schéma. */
  answeredMonth: number;
  rejectedMonth: number;
}

/**
 * Coût estimé du jour et du mois (UTC, comme le plafond de la passerelle), plafond, sorties rejetées et
 * coupure de chaque usage. Un usage est dit plafonné quand sa sortie la plus chère ne tient plus sous ce
 * qui reste du plafond, la règle même de la passerelle.
 */
export async function readAiUsage(
  db: Db,
  ai: GameConfig['ai'],
  now: Date,
): Promise<AiUsageFigures[]> {
  const { rows } = await sql<{
    usage: AiUsage;
    month: string;
    today: string;
    answered: string;
    rejected: string;
  }>`
    with bounds as (
      select date_trunc('month', ${now}::timestamptz at time zone 'UTC') at time zone 'UTC' as month_start,
             date_trunc('day', ${now}::timestamptz at time zone 'UTC') at time zone 'UTC' as day_start)
    select c.usage,
           coalesce(sum(c.cost_micro_euros), 0)::text as month,
           coalesce(sum(c.cost_micro_euros) filter (where c.called_at >= b.day_start), 0)::text as today,
           count(*) filter (where c.outcome in ('ok', 'invalid'))::text as answered,
           count(*) filter (where c.outcome = 'invalid')::text as rejected
    from telemetry.ai_calls c, bounds b
    where c.called_at >= b.month_start and c.called_at < b.month_start + interval '1 month'
    group by c.usage`.execute(db);
  return AI_USAGES.map((usage) => {
    const row = rows.find((candidate) => candidate.usage === usage);
    const settings = ai.usages[usage];
    const capMicroEuros = aiMonthlyCapMicroEuros(ai, usage);
    const spentMonthMicroEuros = Number(row?.month ?? 0);
    const reserve = estimateCostMicroEuros(settings, 0, settings.maxOutputTokens);
    return {
      usage,
      cut: !settings.enabled
        ? 'disabled'
        : spentMonthMicroEuros + reserve > capMicroEuros
          ? 'capped'
          : null,
      capMicroEuros,
      spentTodayMicroEuros: Number(row?.today ?? 0),
      spentMonthMicroEuros,
      answeredMonth: Number(row?.answered ?? 0),
      rejectedMonth: Number(row?.rejected ?? 0),
    };
  });
}

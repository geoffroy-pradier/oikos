import { nextDailyClose, type DayClock } from '@oikos/sim';
import { z } from 'zod';

const clockRowSchema = z.object({
  daily_close_hour: z.number().int().min(0).max(23).nullable(),
  timezone: z.string().min(1).nullable(),
});

/**
 * Horloge du monde (vue `public.clock_rules`, une ligne) : `clock` nul sans configuration en vigueur, sans section
 * d'horloge ou sous un fuseau que la base ne connaît pas (aucune clôture n'est alors annoncée). Rend `null` si la
 * ligne n'a pas la forme attendue.
 */
export function parseClockRules(raw: unknown): { clock: DayClock | null } | null {
  if (raw === null) return { clock: null };
  const parsed = clockRowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { daily_close_hour: dailyCloseHour, timezone } = parsed.data;
  return {
    clock: dailyCloseHour === null || timezone === null ? null : { dailyCloseHour, timezone },
  };
}

/**
 * Prochaine clôture quotidienne après `now`, si l'horloge du monde est connue. Un fuseau que la base connaît mais
 * pas le navigateur (`Intl`, liste de fuseaux plus ancienne) ne fait pas tomber l'en-tête de chaque écran : nul.
 */
export function nextClose(now: Date, clock: DayClock | null | undefined): Date | null {
  if (!clock) return null;
  try {
    return nextDailyClose(now, clock);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

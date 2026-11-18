import { z } from 'zod';

/**
 * Natures des flux de trésorerie d'une maison (vue `my_cash_flows`, 4.1), dans leur ordre d'affichage. Une nature
 * plus récente que le client se lit quand même, en fin de jour, sous son identifiant.
 */
export const HOUSE_NATURES = [
  'sales',
  'taxes',
  'purchases',
  'upkeep',
  'wages',
  'lodging',
  'rents',
  'transport',
  'acquisitions',
  'offerings',
  'grant',
  'escrow',
  'other',
] as const;

/** Flux d'un jour de jeu de la trésorerie, par nature ; `day` est `null` sans horloge en vigueur. */
export interface CashFlowDay {
  day: number | null;
  flows: { nature: string; amount: number }[];
  net: number;
}

const flowRow = z.object({
  house_id: z.string().min(1),
  account: z.string().min(1),
  game_day: z.number().int().nullable(),
  nature: z.string().min(1),
  amount: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
});

/**
 * Flux de la trésorerie de la maison, regroupés par jour de jeu, du plus récent au plus ancien, chaque jour dans
 * l'ordre des natures ; `null` si une ligne est illisible ou si un net dépasse les entiers sûrs.
 */
export function parseCashFlowDays(rows: unknown, houseId: string): CashFlowDay[] | null {
  const parsed = z.array(flowRow).safeParse(rows);
  if (!parsed.success) return null;
  const days = new Map<number | null, CashFlowDay>();
  for (const row of parsed.data) {
    if (row.house_id !== houseId || row.account !== 'treasury') continue;
    const day = days.get(row.game_day) ?? { day: row.game_day, flows: [], net: 0 };
    day.flows.push({ nature: row.nature, amount: row.amount });
    day.net += row.amount;
    days.set(row.game_day, day);
  }
  const order = (nature: string) => {
    const index = (HOUSE_NATURES as readonly string[]).indexOf(nature);
    return index < 0 ? HOUSE_NATURES.length : index;
  };
  const sorted = [...days.values()]
    .map((day) => ({ ...day, flows: day.flows.sort((a, b) => order(a.nature) - order(b.nature)) }))
    .sort((a, b) => (b.day ?? -Infinity) - (a.day ?? -Infinity));
  return sorted.every((day) => Number.isSafeInteger(day.net)) ? sorted : null;
}

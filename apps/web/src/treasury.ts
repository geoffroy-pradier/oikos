import { z } from 'zod';

const id = z.string().min(1);
const amount = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

/** Natures des flux du trésor (vue `city_treasury_flows`) ; `other` : toute écriture qu'elles ne nomment pas. */
export const TREASURY_NATURES = [
  'market_tax',
  'port_dues',
  'public_works',
  'festival',
  'other',
] as const;
export type TreasuryNature = (typeof TREASURY_NATURES)[number];

/** Flux d'un jour de jeu, par nature ; `day` est `null` sans horloge en vigueur. */
export interface TreasuryDay {
  day: number | null;
  flows: { nature: TreasuryNature; amount: number }[];
  net: number;
}

const flowRow = z.object({
  city_id: id,
  game_day: z.number().int().nullable(),
  nature: z.enum(TREASURY_NATURES),
  amount,
});

/** Solde du trésor de la cité (vue `city_treasury`) ; `null` si la ligne est illisible, 0 sans ligne. */
export function parseTreasuryBalance(rows: unknown, cityId: string): number | null {
  const parsed = z.array(z.object({ city_id: id, balance: amount })).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data.find((row) => row.city_id === cityId)?.balance ?? 0;
}

/**
 * Flux du trésor d'une cité, regroupés par jour de jeu, du plus récent au plus ancien, chaque jour dans
 * l'ordre des natures ; `null` si une ligne est illisible (une nature inconnue comprise).
 */
export function parseTreasuryDays(rows: unknown, cityId: string): TreasuryDay[] | null {
  const parsed = z.array(flowRow).safeParse(rows);
  if (!parsed.success) return null;
  const days = new Map<number | null, TreasuryDay>();
  for (const row of parsed.data.filter((flow) => flow.city_id === cityId)) {
    const day = days.get(row.game_day) ?? { day: row.game_day, flows: [], net: 0 };
    day.flows.push({ nature: row.nature, amount: row.amount });
    day.net += row.amount;
    days.set(row.game_day, day);
  }
  const order = (nature: TreasuryNature) => TREASURY_NATURES.indexOf(nature);
  return [...days.values()]
    .map((day) => ({ ...day, flows: day.flows.sort((a, b) => order(a.nature) - order(b.nature)) }))
    .sort((a, b) => (b.day ?? -Infinity) - (a.day ?? -Infinity));
}

/** Taux en vigueur de la cité (vue `city_rates`) ; `null` si sa ligne manque ou est illisible. */
export function parseCityRate(rows: unknown, cityId: string) {
  const parsed = z
    .array(
      z.object({
        city_id: id,
        market_tax_rate_bps: z.number().int().min(0).max(10_000),
        port_dues_coefficient_bps: z.number().int().min(0),
      }),
    )
    .safeParse(rows);
  const row = parsed.success ? parsed.data.find((rate) => rate.city_id === cityId) : undefined;
  return row
    ? {
        marketTaxRateBps: row.market_tax_rate_bps,
        portDuesCoefficientBps: row.port_dues_coefficient_bps,
      }
    : null;
}

import { DEFAULT_MARKET_TAX } from '@oikos/config/schema';
import { marketTax, type MarketTaxRule } from '@oikos/sim';
import { z } from 'zod';

const bps = z.number().int().min(0).max(10_000);
/**
 * Ce que le client lit de la taxe de marché (vue `public.market_rules`, une ligne). Souple sur la forme,
 * tenu sur les valeurs, comme `site-rules.ts`. Version publiée avant la taxe : taux nul du schéma partagé.
 */
const marketRulesSchema = z.object({
  market_tax: z
    .object({ rateBps: bps, burnShareBps: bps })
    .nullable()
    .transform((tax) => tax ?? DEFAULT_MARKET_TAX),
});

/** Rend `null` si la ligne manque ou n'a pas la forme attendue : la taxe est alors inconnue, pas nulle. */
export function parseMarketTax(raw: unknown): MarketTaxRule | null {
  const parsed = marketRulesSchema.safeParse(raw);
  return parsed.success ? parsed.data.market_tax : null;
}

/**
 * Ce qu'une vente rapporte au vendeur, taxe déduite échange par échange (5.3), calculé comme le font
 * l'API et le moteur. Indicatif : le grand livre fait foi.
 */
export function netProceeds(rule: MarketTaxRule, trades: { price: number; quantity: number }[]) {
  return trades.reduce((sum, trade) => sum + marketTax(trade.price * trade.quantity, rule).net, 0);
}

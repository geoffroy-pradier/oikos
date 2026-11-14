import type { MarketPlaceOrderInput, MarketPlaceOrderOutput } from '@oikos/contracts';
import type { MarketTaxRule } from '@oikos/sim';
import { netProceeds } from './market-rules';

export interface OrderNotice {
  /** Clé de traduction sous `agora.`. */
  key:
    | 'placedSell'
    | 'sold'
    | 'soldPartly'
    | 'soldGross'
    | 'soldPartlyGross'
    | 'bought'
    | 'boughtShort'
    | 'boughtPartly'
    | 'placedBuy';
  /** Quantité échangée à l'arrivée (ou déposée, si rien ne s'est échangé). */
  quantity: number;
  wanted: number;
  /**
   * Monnaie échangée à l'arrivée, en oboles : ce que paie l'acheteur, ce que touche le vendeur taxe de
   * marché déduite. Taxe inconnue (`soldGross`, `soldPartlyGross`) : montant brut, annoncé comme tel.
   */
  amount: number;
  /** Achat qui attend : monnaie retenue au séquestre (prix limite × reste), en oboles. */
  held: number;
}

/**
 * Ce qu'il faut annoncer au joueur après le dépôt d'un ordre, d'après la réponse de l'API et la taxe de
 * marché en vigueur (`null` si elle n'a pas pu être lue).
 */
export function orderNotice(
  input: Pick<MarketPlaceOrderInput, 'side' | 'price' | 'quantity'>,
  result: MarketPlaceOrderOutput,
  tax: MarketTaxRule | null,
): OrderNotice {
  const quantity = result.trades.reduce((sum, trade) => sum + trade.quantity, 0);
  const amount = result.trades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
  const resting = result.status === 'open';
  const held = input.side === 'buy' && resting ? input.price * result.remaining : 0;
  const base = { wanted: input.quantity, amount, held };
  if (quantity === 0)
    return {
      ...base,
      key: input.side === 'sell' ? 'placedSell' : 'placedBuy',
      quantity: input.quantity,
    };
  if (input.side === 'sell') {
    const key = resting ? 'soldPartly' : 'sold';
    return tax
      ? { ...base, key, quantity, amount: netProceeds(tax, result.trades) }
      : { ...base, key: `${key}Gross`, quantity };
  }
  const key = resting ? 'boughtPartly' : result.status === 'filled' ? 'bought' : 'boughtShort';
  return { ...base, key, quantity };
}

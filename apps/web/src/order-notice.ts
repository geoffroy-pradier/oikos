import type { MarketPlaceOrderInput, MarketPlaceOrderOutput } from '@oikos/contracts';

export interface OrderNotice {
  /** Clé de traduction sous `agora.`. */
  key:
    'placedSell' | 'sold' | 'soldPartly' | 'bought' | 'boughtShort' | 'boughtPartly' | 'placedBuy';
  /** Quantité échangée à l'arrivée (ou déposée, si rien ne s'est échangé). */
  quantity: number;
  wanted: number;
  /** Monnaie échangée à l'arrivée, en oboles. */
  amount: number;
  /** Achat qui attend : monnaie retenue au séquestre (prix limite × reste), en oboles. */
  held: number;
}

/** Ce qu'il faut annoncer au joueur après le dépôt d'un ordre, d'après la réponse de l'API. */
export function orderNotice(
  input: Pick<MarketPlaceOrderInput, 'side' | 'price' | 'quantity'>,
  result: MarketPlaceOrderOutput,
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
  if (input.side === 'sell') return { ...base, key: resting ? 'soldPartly' : 'sold', quantity };
  const key = resting ? 'boughtPartly' : result.status === 'filled' ? 'bought' : 'boughtShort';
  return { ...base, key, quantity };
}

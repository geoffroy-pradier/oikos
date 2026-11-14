import { z } from 'zod';

/** Bornes techniques : prix × quantité reste un entier exact, loin de toute valeur de jeu plausible. */
export const MAX_ORDER_PRICE = 1_000_000_000;
export const MAX_ORDER_QUANTITY = 1_000_000;

/** Commande `market.placeOrder` : dépose un ordre à cours limité à l'agora d'une cité. */
export const marketPlaceOrderInputSchema = z.strictObject({
  cityId: z.uuid(),
  goodId: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  side: z.enum(['buy', 'sell']),
  /** Prix limite par unité, en oboles. */
  price: z.number().int().positive().max(MAX_ORDER_PRICE),
  quantity: z.number().int().positive().max(MAX_ORDER_QUANTITY),
});
export type MarketPlaceOrderInput = z.infer<typeof marketPlaceOrderInputSchema>;

const fill = z.strictObject({
  price: z.number().int().positive(),
  quantity: z.number().int().positive(),
});

export const marketPlaceOrderOutputSchema = z.object({
  orderId: z.uuid(),
  status: z.enum(['open', 'filled', 'cancelled']),
  /** Quantité non exécutée : en attente pour une vente, annulée pour un achat. */
  remaining: z.number().int().nonnegative(),
  /** Échanges conclus à l'arrivée, chacun au prix de l'ordre de vente servi. */
  trades: z.array(fill),
  /** Achat : vrai si une vente au prix limite restait à servir et que la trésorerie n'y suffisait pas. */
  shortOfFunds: z.boolean().optional(),
});
export type MarketPlaceOrderOutput = z.infer<typeof marketPlaceOrderOutputSchema>;

export const MARKET_PLACE_ORDER_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  'CITY_NOT_FOUND',
  'GOOD_NOT_FOUND',
  'INSUFFICIENT_STOCK',
  'INSUFFICIENT_FUNDS',
] as const;
export type MarketPlaceOrderErrorCode = (typeof MARKET_PLACE_ORDER_ERROR_CODES)[number];

export const orderPlacedSchema = z.strictObject({
  type: z.literal('OrderPlaced'),
  payload: z.strictObject({
    orderId: z.uuid(),
    houseId: z.uuid(),
    cityId: z.uuid(),
    goodId: z.string(),
    side: z.enum(['buy', 'sell']),
    price: z.number().int().positive(),
    quantity: z.number().int().positive(),
  }),
});

export const tradeExecutedSchema = z.strictObject({
  type: z.literal('TradeExecuted'),
  payload: z.strictObject({
    tradeId: z.uuid(),
    cityId: z.uuid(),
    goodId: z.string(),
    sellOrderId: z.uuid(),
    buyOrderId: z.uuid().nullable(),
    price: z.number().int().positive(),
    quantity: z.number().int().positive(),
  }),
});

/** Commande `market.cancelOrder` : annule un ordre encore ouvert de sa propre maison. */
export const marketCancelOrderInputSchema = z.strictObject({ orderId: z.uuid() });
export type MarketCancelOrderInput = z.infer<typeof marketCancelOrderInputSchema>;

export const marketCancelOrderOutputSchema = z.object({
  orderId: z.uuid(),
  status: z.literal('cancelled'),
  /** Quantité qui restait à servir : pour une vente, le stock que l'annulation libère. */
  released: z.number().int().positive(),
});
export type MarketCancelOrderOutput = z.infer<typeof marketCancelOrderOutputSchema>;

export const MARKET_CANCEL_ORDER_ERROR_CODES = ['ORDER_NOT_FOUND', 'ORDER_NOT_OPEN'] as const;
export type MarketCancelOrderErrorCode = (typeof MARKET_CANCEL_ORDER_ERROR_CODES)[number];

export const orderCancelledSchema = z.strictObject({
  type: z.literal('OrderCancelled'),
  payload: z.strictObject({
    orderId: z.uuid(),
    houseId: z.uuid(),
    cityId: z.uuid(),
    goodId: z.string(),
    side: z.enum(['buy', 'sell']),
    /** Quantité non servie au moment de l'annulation. */
    released: z.number().int().positive(),
  }),
});

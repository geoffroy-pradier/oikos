import {
  MARKET_PLACE_ORDER_ERROR_CODES,
  SITE_COLLECT_ERROR_CODES,
  marketPlaceOrderInputSchema,
  marketPlaceOrderOutputSchema,
  siteCollectInputSchema,
  siteCollectOutputSchema,
} from '@oikos/contracts';
import { collectSite, placeOrder } from '@oikos/operations';
import { defineCommand, type CommandContext } from '../registry';

/**
 * Commandes du joueur dont le cœur est partagé avec les intendants du moteur (`@oikos/operations`, ADR 0009) :
 * le registre tient la transaction, la clé d'idempotence, le journal et les événements ; le cœur agit pour la
 * maison du compte authentifié.
 */
const operationContext = ({ trx, emit, config, now }: CommandContext) => ({
  trx,
  emit,
  config,
  now,
});

/** Récolte d'un site (`collectSite`). */
export const siteCollect = defineCommand({
  name: collectSite.name,
  input: siteCollectInputSchema,
  output: siteCollectOutputSchema,
  errors: SITE_COLLECT_ERROR_CODES,
  handler: (context, input) =>
    collectSite.run(operationContext(context), { userId: context.userId }, input),
});

/** Ordre à l'agora (`placeOrder`). */
export const marketPlaceOrder = defineCommand({
  name: placeOrder.name,
  input: marketPlaceOrderInputSchema,
  output: marketPlaceOrderOutputSchema,
  errors: MARKET_PLACE_ORDER_ERROR_CODES,
  ...(placeOrder.errorByConstraint && { errorByConstraint: placeOrder.errorByConstraint }),
  handler: (context, input) =>
    placeOrder.run(operationContext(context), { userId: context.userId }, input),
});

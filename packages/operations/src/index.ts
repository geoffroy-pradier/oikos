/**
 * Cœur transactionnel des opérations de jeu partagées par l'API (commandes du joueur) et le moteur (intendants,
 * #279), sans entrée-sortie hors de la transaction reçue (ADR 0009).
 */
export {
  defineOperation,
  houseOf,
  type Actor,
  type OperationContext,
  type OperationDefinition,
  type OperationResult,
} from './context';
export { placeOrder } from './market-place-order';
export { collectSite } from './site-collect';

/** Moteur : ticks, tâches, IA. */
export {
  dryRunTick,
  runTick,
  type TickContext,
  type TickOutcome,
  type TickRequest,
  type TickStep,
} from './tick';
export { advanceAllWorlds, advanceWorld, dueTicks, MAX_CATCH_UP_TICKS } from './scheduler';
export { npcDemand } from './steps/npc-demand';
export { observedPricesStep } from './steps/observed-prices';
export { priceCandlesStep } from './steps/price-candles';
export { siteUpkeep } from './steps/site-upkeep';

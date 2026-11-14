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
export { priceCandlesStep } from './steps/price-candles';

import { cityProperties } from './steps/city-properties';
import { npcDemand } from './steps/npc-demand';
import { observedPricesStep } from './steps/observed-prices';
import { priceCandlesStep } from './steps/price-candles';
import { voyageArrivals } from './steps/voyage-arrivals';
import type { TickStep } from './tick';

/**
 * Étapes du tick, dans l'ordre : le parc de logements des cités (4.5), que le premier tick qui connaît
 * une cité crée et que les suivants complètent, puis la demande des PNJ, puis l'arrivée des voyages
 * (#253), puis les chandeliers, qui résument aussi les achats que les PNJ viennent de faire, et les prix observés.
 * Une cargaison déchargée par un tick n'est donc offerte aux PNJ qu'au tick suivant, une fois mise en vente.
 */
export const TICK_STEPS: readonly TickStep[] = [
  cityProperties,
  npcDemand,
  voyageArrivals,
  priceCandlesStep,
  observedPricesStep,
];

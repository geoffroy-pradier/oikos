import { describe, expect, it } from 'vitest';
import { cityProperties } from './steps/city-properties';
import { npcDemand } from './steps/npc-demand';
import { observedPricesStep } from './steps/observed-prices';
import { priceCandlesStep } from './steps/price-candles';
import { voyageArrivals } from './steps/voyage-arrivals';
import { TICK_STEPS } from './tick-steps';

describe('étapes du tick du moteur', () => {
  it('le parc des cités d’abord ; l’arrivée des voyages suit la demande des PNJ et précède les chandeliers', () => {
    expect(TICK_STEPS).toEqual([
      cityProperties,
      npcDemand,
      voyageArrivals,
      priceCandlesStep,
      observedPricesStep,
    ]);
    const names = TICK_STEPS.map((step) => step.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

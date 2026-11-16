import { describe, expect, it } from 'vitest';
import { CLOSE_STEPS } from './close-steps';
import { archonOpening } from './steps/archon-opening';
import { archonTally } from './steps/archon-tally';
import { citizenship } from './steps/citizenship';
import { decreeTally } from './steps/decree-tally';
import { leaseRent } from './steps/lease-rent';
import { npcPopulation } from './steps/npc-population';
import { propertyWear } from './steps/property-wear';
import { siteUpkeep } from './steps/site-upkeep';

describe('étapes de la clôture quotidienne du moteur', () => {
  it('l’entretien des sites est joué, et en dernier : il tient ses verrous jusqu’à la validation', () => {
    expect(CLOSE_STEPS).toContain(siteUpkeep);
    expect(CLOSE_STEPS).toContain(npcPopulation);
    expect(CLOSE_STEPS.at(-1)).toBe(siteUpkeep);
    // Avant l'entretien (ordre de clôture de la phase 2), sans monnaie ni stock : la citoyenneté (une
    // maison promue ce jour vote déjà), puis le dépouillement, puis l'ouverture du mandat suivant ; la
    // vétusté des biens juste avant l'entretien, qu'elle précède sous le verrou de l'agora ; les loyers
    // avant elle, les premiers de ce qui touche la monnaie (#257). Le dépouillement des décrets, sans monnaie
    // ni stock, passe avant les loyers.
    const order = [
      citizenship,
      archonTally,
      archonOpening,
      decreeTally,
      npcPopulation,
      leaseRent,
      propertyWear,
      siteUpkeep,
    ].map((step) => CLOSE_STEPS.indexOf(step));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(CLOSE_STEPS.indexOf(propertyWear)).toBe(CLOSE_STEPS.length - 2);
    expect(CLOSE_STEPS.indexOf(leaseRent)).toBe(CLOSE_STEPS.length - 3);
    const names = CLOSE_STEPS.map((step) => step.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

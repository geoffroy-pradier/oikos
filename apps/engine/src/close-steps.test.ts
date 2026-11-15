import { describe, expect, it } from 'vitest';
import { CLOSE_STEPS } from './close-steps';
import { archonTally } from './steps/archon-tally';
import { citizenship } from './steps/citizenship';
import { npcPopulation } from './steps/npc-population';
import { siteUpkeep } from './steps/site-upkeep';

describe('étapes de la clôture quotidienne du moteur', () => {
  it('l’entretien des sites est joué, et en dernier : il tient ses verrous jusqu’à la validation', () => {
    expect(CLOSE_STEPS).toContain(siteUpkeep);
    expect(CLOSE_STEPS).toContain(npcPopulation);
    expect(CLOSE_STEPS.at(-1)).toBe(siteUpkeep);
    // Avant l'entretien (ordre de clôture de la phase 2), sans monnaie ni stock : la citoyenneté (une
    // maison promue ce jour vote déjà), puis le dépouillement des élections.
    const order = [citizenship, archonTally, siteUpkeep].map((step) => CLOSE_STEPS.indexOf(step));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const names = CLOSE_STEPS.map((step) => step.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

import { describe, expect, it } from 'vitest';
import { CLOSE_STEPS } from './close-steps';
import { citizenship } from './steps/citizenship';
import { npcPopulation } from './steps/npc-population';
import { siteUpkeep } from './steps/site-upkeep';

describe('étapes de la clôture quotidienne du moteur', () => {
  it('l’entretien des sites est joué, et en dernier : il tient ses verrous jusqu’à la validation', () => {
    expect(CLOSE_STEPS).toContain(siteUpkeep);
    expect(CLOSE_STEPS).toContain(npcPopulation);
    expect(CLOSE_STEPS.at(-1)).toBe(siteUpkeep);
    // La citoyenneté passe avant l'entretien (ordre de clôture de la phase 2) : elle ne touche ni monnaie
    // ni stock, et une maison promue à cette clôture vote dès le jour qu'elle ouvre.
    expect(CLOSE_STEPS.indexOf(citizenship)).toBeGreaterThanOrEqual(0);
    expect(CLOSE_STEPS.indexOf(citizenship)).toBeLessThan(CLOSE_STEPS.indexOf(siteUpkeep));
    const names = CLOSE_STEPS.map((step) => step.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

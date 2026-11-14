import { describe, expect, it } from 'vitest';
import { CLOSE_STEPS } from './close-steps';
import { siteUpkeep } from './steps/site-upkeep';

describe('étapes de la clôture quotidienne du moteur', () => {
  it('l’entretien des sites est joué, et en dernier : il tient ses verrous jusqu’à la validation', () => {
    expect(CLOSE_STEPS).toContain(siteUpkeep);
    expect(CLOSE_STEPS.at(-1)).toBe(siteUpkeep);
    const names = CLOSE_STEPS.map((step) => step.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

import { describe, expect, it } from 'vitest';
import { numberProblem } from './numbers';

describe('numberProblem', () => {
  const bounds = { min: 10, max: 30_000 };

  it('rien de saisi, ou un nombre dans les bornes : rien à redire', () => {
    for (const typed of ['', '10', '30 000', new Intl.NumberFormat('fr').format(12_500)])
      expect(numberProblem(typed, 'fr', bounds)).toBeNull();
    expect(numberProblem('2,5', 'fr', { step: 0.5 })).toBeNull();
  });

  it('illisible, ambigu, non entier pour un pas entier, puis hors des bornes', () => {
    expect(numberProblem('douze', 'fr', bounds)).toBe('unreadable');
    expect(numberProblem('30,000', 'fr', bounds)).toBe('ambiguous');
    expect(numberProblem('12,5', 'fr', bounds)).toBe('notInteger');
    expect(numberProblem('9', 'fr', bounds)).toBe('belowMin');
    expect(numberProblem('30,001', 'en', bounds)).toBe('aboveMax');
  });
});

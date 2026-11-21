import { describe, expect, it } from 'vitest';
import { countLevy, newLiturgies } from './liturgy';

describe('compte des liturgies du banc (#721)', () => {
  it('le prélèvement d’office est lu dans le résumé de l’étape de la clôture, jour après jour', () => {
    const liturgies = newLiturgies();
    countLevy(liturgies, { liturgyLevy: { levied: 3, leviedOboles: 1_200, partial: 1 } });
    countLevy(liturgies, { liturgyLevy: { levied: 0, leviedOboles: 0, partial: 0 } });
    countLevy(liturgies, { liturgyLevy: { levied: 2, leviedOboles: 300, partial: 0 } });
    expect(liturgies).toEqual({
      performed: 0,
      performedOboles: 0,
      evaded: 0,
      leviedOboles: 1_500,
      partial: 1,
    });
  });

  it('une clôture sans l’étape de prélèvement ne compte rien', () => {
    const liturgies = newLiturgies();
    countLevy(liturgies, {});
    expect(liturgies).toEqual(newLiturgies());
  });
});

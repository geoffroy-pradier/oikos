import { describe, expect, it } from 'vitest';
import { referenceOf } from './city';
import { shouldDepart, tradeValueOf } from './carrier';

/*
 * Fortune de négoce de l'armateur et règle de départ du navire (#1058).
 */
describe('valeur de la marchandise de négoce', () => {
  it('compte au prix de référence les biens portés, en entiers comme en chaînes de la base', () => {
    const value = tradeValueOf(
      [
        { good_id: 'wheat', quantity: 4 },
        { good_id: 'wheat', quantity: '6' },
        { good_id: 'salt', quantity: 3 },
      ],
      new Set(['wheat', 'salt']),
    );
    expect(value).toBe(10 * referenceOf('wheat') + 3 * referenceOf('salt'));
    expect(value).toBeGreaterThan(0);
  });

  it('laisse de côté les biens que l’armateur ne porte pas, dont la récolte de son site d’attache', () => {
    const rows = [
      { good_id: 'wheat', quantity: 5 },
      { good_id: 'fish', quantity: 500 },
    ];
    expect(tradeValueOf(rows, new Set(['wheat']))).toBe(5 * referenceOf('wheat'));
    expect(tradeValueOf(rows, new Set())).toBe(0);
  });
});

describe('règle de départ du navire', () => {
  const ship = { capacityUnits: 100, waitedHours: 0, waitedAtOtherEnd: true };

  it('part dès que la cargaison remplit la moitié de la soute, sans attendre', () => {
    expect(shouldDepart({ ...ship, cargoUnits: 50 })).toBe(true);
    expect(shouldDepart({ ...ship, cargoUnits: 49 })).toBe(false);
  });

  it('attend sept heures avant de partir avec une demi-soute ou moins', () => {
    expect(shouldDepart({ ...ship, cargoUnits: 10, waitedHours: 7 })).toBe(false);
    expect(shouldDepart({ ...ship, cargoUnits: 10, waitedHours: 8 })).toBe(true);
  });

  it('ne part pas à vide quand l’autre bout attend quelque chose de lui, si longue que soit l’attente', () => {
    expect(shouldDepart({ ...ship, cargoUnits: 0, waitedHours: 100 })).toBe(false);
  });

  it('part à vide, le délai passé, quand l’autre bout n’attend rien', () => {
    expect(shouldDepart({ ...ship, cargoUnits: 0, waitedHours: 8, waitedAtOtherEnd: false })).toBe(
      true,
    );
    expect(shouldDepart({ ...ship, cargoUnits: 0, waitedHours: 7, waitedAtOtherEnd: false })).toBe(
      false,
    );
  });
});

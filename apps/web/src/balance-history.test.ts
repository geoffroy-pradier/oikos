// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { balanceHistory, variation } from './balance-history';

const day = (index: number | null, net: number) => ({ day: index, flows: [], net });

describe('historique du solde', () => {
  it('retrouve le solde de fin de chaque jour à rebours ; un jour sans flux garde celui de la veille', () => {
    // Solde lu : 500. Aujourd'hui (jour 10) +30, jour 8 −100, jour 5 (hors fenêtre) +999.
    const points = balanceHistory(500, [day(10, 30), day(8, -100), day(5, 999)], 10, 4);
    expect(points).toEqual([
      { day: 7, balance: 570, net: 0 },
      { day: 8, balance: 470, net: -100 },
      { day: 9, balance: 470, net: 0 },
      { day: 10, balance: 500, net: 30 },
    ]);
    expect(variation(points, 2)).toBe(30);
    expect(variation(points, 4)).toBe(-70);
  });

  it('un flux sans jour de jeu n’est pas compté ; aucun flux : un solde constant', () => {
    expect(balanceHistory(42, [day(null, 7)], 3, 2)).toEqual([
      { day: 2, balance: 42, net: 0 },
      { day: 3, balance: 42, net: 0 },
    ]);
  });
});

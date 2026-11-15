import { describe, expect, it } from 'vitest';
import { commonIds, NO_IDS, retiredUsage } from './config-usage';

const ids = (goods: string[], recipes: string[], npcClasses: string[]) => ({
  goods,
  recipes,
  npcClasses,
});

describe('lecture des usages retirés (#191, #200)', () => {
  it('la base ne lit que ce qu’au moins une version retire : les identifiants communs à toutes', () => {
    const versions = [
      ids(['wheat', 'bread'], ['bake', 'grow'], ['thetes', 'hippeis']),
      ids(['wheat'], ['grow', 'bake'], ['thetes']),
    ];
    expect(commonIds(versions)).toEqual(ids(['wheat'], ['bake', 'grow'], ['thetes']));
    // Une version illisible ne connaît rien : tout est lu. Sans version, rien n'est tenu pour connu.
    expect(commonIds([...versions, NO_IDS])).toEqual(NO_IDS);
    expect(commonIds([])).toEqual(NO_IDS);
  });

  it('répartit la lecture : chaque version ne garde que ce qu’elle ne connaît pas', () => {
    const usage = {
      goods: [{ goodId: 'bread', houses: 1, quantity: 3, openOrders: 0, escrowOboles: 0 }],
      recipes: [
        { recipeId: 'bake', sites: 2, houses: 1 },
        { recipeId: 'mill', sites: 1, houses: 1 },
      ],
      npcClasses: [{ classId: 'hippeis', cities: 2, population: 0 }],
    };
    expect(retiredUsage(usage, ids(['bread'], ['bake'], []))).toEqual({
      goods: [],
      recipes: [{ recipeId: 'mill', sites: 1, houses: 1 }],
      npcClasses: usage.npcClasses,
    });
    expect(retiredUsage(usage, NO_IDS)).toEqual(usage);
  });
});

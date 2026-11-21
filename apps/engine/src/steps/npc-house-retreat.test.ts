import { describe, expect, it } from 'vitest';
import { retreatSites } from './npc-house-retreat';

describe('sites du retrait d’une maison PNJ (#717)', () => {
  it('sites fermés et rouverts : le plus récent des ouverts, le plus ancien des fermés qui a sa place', () => {
    const at = new Date();
    const site = (id: string, recipe_id: string, closed = false) => ({
      id,
      recipe_id,
      closed_at: closed ? at : null,
      halted_at: null,
    });
    const chain = { sites: { grow_wheat: 2, mill_flour: 1 } };
    expect(retreatSites([site('a', 'grow_wheat'), site('b', 'grow_wheat')], chain)).toMatchObject({
      open: 2,
      max: 2,
      toClose: { id: 'b' },
      toReopen: undefined,
    });
    const closed = [
      site('a', 'grow_wheat', true),
      site('b', 'mill_flour', true),
      site('c', 'grow_wheat'),
    ];
    expect(retreatSites(closed, chain)).toMatchObject({
      open: 1,
      max: 3,
      toClose: { id: 'c' },
      toReopen: { id: 'a' },
    });
    // Une filière qui ne donne plus de moulin : le moulin fermé ne se rouvre pas ; aucun site, rien à fermer.
    expect(retreatSites(closed, { sites: { grow_wheat: 1 } })).toMatchObject({
      open: 1,
      max: 1,
      toReopen: undefined,
    });
    expect(retreatSites([], chain)).toMatchObject({ open: 0, max: 0, toClose: undefined });
  });
});

import { describe, expect, it } from 'vitest';
import { diffConfigs } from './diff';

const base = {
  clock: { tickMinutes: 10, timezone: 'Europe/Paris' },
  goods: [
    { id: 'wheat', referencePriceOboles: 6 },
    { id: 'bread', referencePriceOboles: 15 },
  ],
  npcClasses: [{ id: 'thetes', basket: [{ goodId: 'wheat', quantityPerThousand: 24 }] }],
  tags: ['a', 'b'],
};

describe('comparaison de deux configurations', () => {
  it('ne trouve rien entre deux configurations identiques, même réordonnées', () => {
    expect(diffConfigs(base, structuredClone(base))).toEqual([]);
    const reordered = { ...base, goods: [...base.goods].reverse() };
    expect(diffConfigs(base, reordered)).toEqual([]);
  });

  it('nomme la valeur changée par son chemin, identifiants compris', () => {
    const next = structuredClone(base);
    next.clock.tickMinutes = 5;
    (next.goods[1] as { referencePriceOboles: number }).referencePriceOboles = 16;
    (next.npcClasses[0]?.basket[0] as { quantityPerThousand: number }).quantityPerThousand = 20;
    expect(diffConfigs(base, next)).toEqual([
      { path: 'clock.tickMinutes', before: 10, after: 5 },
      { path: 'goods[bread].referencePriceOboles', before: 15, after: 16 },
      { path: 'npcClasses[thetes].basket[wheat].quantityPerThousand', before: 24, after: 20 },
    ]);
  });

  it('un bien ajouté ou retiré est une seule différence', () => {
    const added = { ...base, goods: [...base.goods, { id: 'wine', referencePriceOboles: 36 }] };
    expect(diffConfigs(base, added)).toEqual([
      { path: 'goods[wine]', before: undefined, after: { id: 'wine', referencePriceOboles: 36 } },
    ]);
    expect(diffConfigs(added, base)).toEqual([
      { path: 'goods[wine]', before: { id: 'wine', referencePriceOboles: 36 }, after: undefined },
    ]);
  });

  it('compare par rang les listes sans identifiant, et signale un changement de nature', () => {
    expect(diffConfigs(base, { ...base, tags: ['a', 'c', 'd'] })).toEqual([
      { path: 'tags[1]', before: 'b', after: 'c' },
      { path: 'tags[2]', before: undefined, after: 'd' },
    ]);
    expect(diffConfigs({ clock: { a: 1 } }, { clock: 3 })).toEqual([
      { path: 'clock', before: { a: 1 }, after: 3 },
    ]);
    expect(diffConfigs({ a: null }, { a: 0 })).toEqual([{ path: 'a', before: null, after: 0 }]);
  });

  it('des identifiants en double font retomber sur la comparaison par rang', () => {
    const twice = [
      { id: 'x', v: 1 },
      { id: 'x', v: 2 },
    ];
    expect(
      diffConfigs(twice, [
        { id: 'x', v: 1 },
        { id: 'x', v: 3 },
      ]),
    ).toEqual([{ path: '[1].v', before: 2, after: 3 }]);
  });
});

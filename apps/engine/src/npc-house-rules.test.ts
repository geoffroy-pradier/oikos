import { INITIAL_CONFIG, npcRuleSchema, type GameConfig, type NpcHouses } from '@oikos/config';
import { stewardRuleSchema } from '@oikos/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { npcFoundingOrder, npcOrderJustified, npcSiteRules } from './npc-house-rules';

const FIELD = [
  { kind: 'collect' },
  { kind: 'sell', goodId: 'wheat', minPriceOboles: 6, keepUnits: 0 },
] as const;
const configWith = (npcHouses: NpcHouses) => ({ ...(INITIAL_CONFIG as GameConfig), npcHouses });
const npc: NpcHouses = {
  kalliste: {
    treasuryCapOboles: 1,
    chains: [
      {
        id: 'wheat',
        name: 'Moissons',
        sites: { grow_wheat: 1, mill_flour: 1 },
        grantOboles: 0,
        rules: { grow_wheat: [...FIELD] },
      },
    ],
  },
};
const site = { slug: 'kalliste', chain_id: 'wheat', recipe_id: 'grow_wheat' };

describe('règles d’un site d’une maison PNJ (#716)', () => {
  it('celles de la recette du site dans la filière de sa maison, et rien ailleurs', () => {
    expect(npcSiteRules(configWith(npc), site)).toEqual(FIELD);
    expect(npcSiteRules(configWith(npc), { ...site, recipe_id: 'mill_flour' })).toEqual([]);
    expect(npcSiteRules(configWith(npc), { ...site, chain_id: 'flour' })).toEqual([]);
    expect(npcSiteRules(configWith(npc), { ...site, slug: 'elaia' })).toEqual([]);
    // Une cité nommée comme une propriété d'objet n'est pas une cité de la configuration.
    expect(npcSiteRules(configWith(npc), { ...site, slug: 'constructor' })).toEqual([]);
    expect(npcSiteRules(configWith({}), site)).toEqual([]);
  });

  it('relues par la grammaire des intendants : des règles qu’elle refuse ne sont pas menées', () => {
    const twice = structuredClone(npc);
    const chain = twice['kalliste']?.chains[0];
    if (chain) chain.rules = { grow_wheat: [{ kind: 'collect' }, { kind: 'collect' }] };
    expect(npcSiteRules(configWith(twice), site)).toEqual([]);
  });

  it('toute règle que la configuration admet, la grammaire des intendants l’admet aussi', () => {
    const rule = fc.oneof(
      fc.record({ kind: fc.constant('collect') }),
      fc.record({
        kind: fc.constant('sell'),
        goodId: fc.constantFrom('wheat', 'flour'),
        minPriceOboles: fc.integer({ min: -1, max: 1_000_000_001 }),
        keepUnits: fc.integer({ min: -1, max: 1_000_001 }),
      }),
      fc.record({
        kind: fc.constant('buy'),
        goodId: fc.constantFrom('wheat', 'flour'),
        maxPriceOboles: fc.integer({ min: -1, max: 1_000_000_001 }),
        targetUnits: fc.integer({ min: -1, max: 1_000_001 }),
      }),
    );
    fc.assert(
      fc.property(rule, (candidate) => {
        expect(npcRuleSchema.safeParse(candidate).success).toBe(
          stewardRuleSchema.safeParse(candidate).success,
        );
      }),
      { numRuns: 500 },
    );
  });
});

describe('ordres d’une maison PNJ que la configuration justifie (#717)', () => {
  const RULES = [
    { kind: 'sell', goodId: 'wheat', minPriceOboles: 5, keepUnits: 0 },
    { kind: 'buy', goodId: 'flour', maxPriceOboles: 9, targetUnits: 10 },
  ] as const;
  const sell = (price: number, good_id = 'wheat') => ({ side: 'sell' as const, good_id, price });
  const buy = (price: number, good_id = 'flour') => ({ side: 'buy' as const, good_id, price });

  it('l’ordre qu’une règle des sites ouverts poserait, à son prix, au plus au prix de référence', () => {
    expect(npcOrderJustified(sell(5), RULES, 6, false)).toBe(true);
    expect(npcOrderJustified(buy(9), RULES, 10, false)).toBe(true);
    // Prix changé par la version, règle retirée, autre bien : plus justifié.
    expect(npcOrderJustified(sell(6), RULES, 6, false)).toBe(false);
    expect(npcOrderJustified(buy(8), RULES, 10, false)).toBe(false);
    expect(npcOrderJustified(sell(5, 'flour'), RULES, 10, false)).toBe(false);
    expect(npcOrderJustified(sell(5), [], 6, false)).toBe(false);
    // Prix de référence baissé sous l'ordre, ou bien inconnu : plus justifié, même par sa règle.
    expect(npcOrderJustified(sell(5), RULES, 4, false)).toBe(false);
    expect(npcOrderJustified(buy(9), RULES, 8, false)).toBe(false);
    expect(npcOrderJustified(sell(5), RULES, undefined, false)).toBe(false);
  });

  it('une maison qui se liquide garde ses ventes au plus au prix de référence, et aucun achat', () => {
    expect(npcOrderJustified(sell(6), [], 6, true)).toBe(true);
    expect(npcOrderJustified(sell(1), [], 6, true)).toBe(true);
    expect(npcOrderJustified(sell(7), [], 6, true)).toBe(false);
    expect(npcOrderJustified(buy(9), RULES, 10, true)).toBe(false);
  });

  it('propriété : jamais un ordre au-dessus du prix de référence, quelles que soient les règles', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('buy' as const, 'sell' as const),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        fc.boolean(),
        (side, price, reference, liquidating) => {
          const rules = [
            { kind: 'sell' as const, goodId: 'wheat', minPriceOboles: price, keepUnits: 0 },
            { kind: 'buy' as const, goodId: 'wheat', maxPriceOboles: price, targetUnits: 1 },
          ];
          const justified = npcOrderJustified(
            { side, good_id: 'wheat', price },
            rules,
            reference,
            liquidating,
          );
          if (price > reference) expect(justified).toBe(false);
          else expect(justified).toBe(side === 'sell' || !liquidating);
        },
      ),
    );
  });
});

describe('ordre des sites des maisons PNJ (#717)', () => {
  it('celui de la fondation, quels que soient les identifiants tirés au hasard', () => {
    const at = new Date('2026-11-21T03:00:00Z');
    const later = new Date('2026-11-22T03:00:00Z');
    const two: NpcHouses = {
      kalliste: {
        treasuryCapOboles: 1,
        chains: [
          {
            id: 'wheat',
            name: 'Moissons',
            sites: { grow_wheat: 1, mill_flour: 1 },
            grantOboles: 0,
          },
          { id: 'fish', name: 'Pêcheries', sites: { catch_fish: 1 }, grantOboles: 0 },
        ],
      },
      elaia: {
        treasuryCapOboles: 1,
        chains: [{ id: 'salt', name: 'Salines', sites: { rake_salt: 1 }, grantOboles: 0 }],
      },
    };
    const site = (slug: string, chain_id: string, recipe_id: string, founded_at = at) => ({
      slug,
      chain_id,
      recipe_id,
      founded_at,
      created_at: founded_at,
      site_id: `${slug}-${recipe_id}`,
    });
    const expected = [
      site('elaia', 'salt', 'rake_salt'),
      site('kalliste', 'wheat', 'grow_wheat'),
      site('kalliste', 'wheat', 'mill_flour'),
      site('kalliste', 'fish', 'catch_fish'),
      site('dikaia', 'wheat', 'grow_wheat', later),
    ];
    fc.assert(
      fc.property(fc.shuffledSubarray(expected, { minLength: expected.length }), (shuffled) => {
        expect(npcFoundingOrder(configWith(two), shuffled)).toEqual(expected);
      }),
    );
  });
});

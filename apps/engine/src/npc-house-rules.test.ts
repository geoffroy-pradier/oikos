import { INITIAL_CONFIG, npcRuleSchema, type GameConfig, type NpcHouses } from '@oikos/config';
import { stewardRuleSchema } from '@oikos/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { npcSiteRules } from './npc-house-rules';

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

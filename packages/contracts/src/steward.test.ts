import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import { MAX_ORDER_PRICE, MAX_ORDER_QUANTITY } from './market';
import {
  MAX_STEWARD_RULES,
  stewardRuleSchema,
  stewardRulesSchema,
  stewardSetRulesInputSchema,
} from './steward';

const ok = (rule: unknown) => stewardRuleSchema.safeParse(rule).success;
const sell = { kind: 'sell', goodId: 'olive_oil', minPriceOboles: 72, keepUnits: 10 };
const buy = { kind: 'buy', goodId: 'olives', maxPriceOboles: 8, targetUnits: 40 };

describe('grammaire fermée des intendants', () => {
  it('trois règles, et rien d’autre', () => {
    expect(ok({ kind: 'collect' })).toBe(true);
    expect(ok(sell)).toBe(true);
    expect(ok(buy)).toBe(true);
    for (const rule of [
      { kind: 'transport', goodId: 'wheat' },
      { kind: 'collect', siteId: '01900000-0000-7000-8000-000000000001' },
      { ...sell, side: 'buy' },
      { ...buy, keepUnits: 1 },
      { kind: 'sell', goodId: 'olive_oil', minPriceOboles: 72 },
      { kind: 'buy', goodId: 'olives', targetUnits: 40 },
      'collect',
      null,
    ])
      expect([rule, ok(rule)]).toEqual([rule, false]);
  });

  it('chaque nombre est un entier borné, aux bornes d’un ordre de l’agora', () => {
    expect(ok({ ...sell, minPriceOboles: MAX_ORDER_PRICE, keepUnits: MAX_ORDER_QUANTITY })).toBe(
      true,
    );
    expect(ok({ ...sell, keepUnits: 0 })).toBe(true);
    expect(ok({ ...buy, maxPriceOboles: 1, targetUnits: 1 })).toBe(true);
    for (const minPriceOboles of [0, -1, 1.5, MAX_ORDER_PRICE + 1, '72', Number.NaN, Infinity])
      expect(ok({ ...sell, minPriceOboles })).toBe(false);
    for (const keepUnits of [-1, 0.5, MAX_ORDER_QUANTITY + 1])
      expect(ok({ ...sell, keepUnits })).toBe(false);
    // Un stock cible nul ne rachèterait jamais rien : il est refusé plutôt que gardé sans effet.
    for (const targetUnits of [0, -3, 2.5, MAX_ORDER_QUANTITY + 1])
      expect(ok({ ...buy, targetUnits })).toBe(false);
    expect(ok({ ...buy, goodId: 'Huile' })).toBe(false);
  });

  it('une règle par sorte et par bien, au plus le plafond technique', () => {
    const parse = (rules: unknown[]) => stewardRulesSchema.safeParse(rules);
    expect(parse([]).success).toBe(true);
    expect(parse([{ kind: 'collect' }, sell, buy, { ...buy, goodId: 'olive_oil' }]).success).toBe(
      true,
    );
    const duplicated = parse([sell, buy, { ...sell, minPriceOboles: 90 }]);
    expect(duplicated.success).toBe(false);
    expect(duplicated.error?.issues.map((issue) => issue.path)).toEqual([[2]]);
    expect(parse([{ kind: 'collect' }, { kind: 'collect' }]).success).toBe(false);
    const many = Array.from({ length: MAX_STEWARD_RULES + 1 }, (_, index) => ({
      ...sell,
      goodId: `good_${index}`,
    }));
    expect(parse(many.slice(0, MAX_STEWARD_RULES)).success).toBe(true);
    expect(parse(many).success).toBe(false);
  });

  it('steward.setRules : un intendant et ses règles, aucun autre champ', () => {
    const stewardId = '01900000-0000-7000-8000-0000000005a1';
    const input = (value: unknown) => stewardSetRulesInputSchema.safeParse(value).success;
    expect(input({ stewardId, rules: [sell] })).toBe(true);
    expect(input({ stewardId })).toBe(false);
    expect(input({ stewardId: 'x', rules: [] })).toBe(false);
    expect(input({ stewardId, rules: [], houseId: stewardId })).toBe(false);
  });

  it('les événements des intendants se relisent tels qu’ils sont écrits', () => {
    const ref = {
      stewardId: '01900000-0000-7000-8000-0000000005a1',
      houseId: '01900000-0000-7000-8000-0000000000a1',
      siteId: '01900000-0000-7000-8000-0000000005b1',
    };
    const events = [
      { type: 'StewardHired' as const, payload: { ...ref, name: 'Nikias' } },
      { type: 'StewardRulesSet' as const, payload: { ...ref, rules: [{ kind: 'collect' }, sell] } },
      { type: 'StewardDismissed' as const, payload: ref },
    ];
    for (const event of events)
      expect(domainEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
    expect(
      domainEventSchema.safeParse({ type: 'StewardHired', payload: { ...ref, name: '' } }).success,
    ).toBe(false);
  });
});

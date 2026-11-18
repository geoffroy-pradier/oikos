import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nextStewardOperation, ruleAction, type StewardPlanRule } from './steward';

const MAX = 1_000_000;
const sightOf = (collectable: boolean, free: Record<string, number>, incoming = free) => ({
  collectable,
  free: (goodId: string) => free[goodId] ?? 0,
  incoming: (goodId: string) => incoming[goodId] ?? 0,
});
const collect = { kind: 'collect' } as const;
const sell = { kind: 'sell', goodId: 'flour', minPriceOboles: 14, keepUnits: 20 } as const;
const buy = { kind: 'buy', goodId: 'wheat', maxPriceOboles: 7, targetUnits: 50 } as const;

describe('action d’une règle', () => {
  it('récolte dès qu’un cycle est écoulé, sinon rien', () => {
    expect(ruleAction(collect, sightOf(true, {}), MAX)).toEqual({ kind: 'collect' });
    expect(ruleAction(collect, sightOf(false, {}), MAX)).toBeNull();
  });

  it('vend au prix plancher le stock libre au-delà de la réserve ; rien à la réserve ou en dessous', () => {
    expect(ruleAction(sell, sightOf(false, { flour: 35 }), MAX)).toEqual({
      kind: 'order',
      side: 'sell',
      goodId: 'flour',
      price: 14,
      quantity: 15,
    });
    expect(ruleAction(sell, sightOf(false, { flour: 20 }), MAX)).toBeNull();
    expect(ruleAction(sell, sightOf(false, { flour: 0 }), MAX)).toBeNull();
    expect(ruleAction({ ...sell, keepUnits: 0 }, sightOf(false, { flour: 1 }), MAX)).toMatchObject({
      quantity: 1,
    });
  });

  it('rachète au prix plafond ce qui manque au stock visé, achats en attente comptés', () => {
    expect(ruleAction(buy, sightOf(false, {}, { wheat: 12 }), MAX)).toMatchObject({
      side: 'buy',
      price: 7,
      quantity: 38,
    });
    expect(ruleAction(buy, sightOf(false, {}, { wheat: 50 }), MAX)).toBeNull();
    expect(ruleAction(buy, sightOf(false, {}, { wheat: 51 }), MAX)).toBeNull();
  });

  it('une quantité est bornée comme un ordre de l’agora', () => {
    const big = { ...buy, targetUnits: MAX };
    expect(ruleAction(big, sightOf(false, {}), 999)).toMatchObject({ quantity: 999 });
    expect(ruleAction(sell, sightOf(false, { flour: MAX * 3 }), MAX)).toMatchObject({
      quantity: MAX,
    });
  });
});

describe('opération suivante d’un intendant', () => {
  it('part de la règle donnée, passe celles qui n’ont rien à faire, revient au début', () => {
    const rules = [collect, sell, buy];
    const sight = sightOf(true, { flour: 30 }, { wheat: 50 });
    expect(nextStewardOperation(rules, 0, sight, MAX)?.position).toBe(0);
    expect(nextStewardOperation(rules, 1, sight, MAX)?.position).toBe(1);
    // Le rachat n'a rien à faire : la file revient à la récolte.
    expect(nextStewardOperation(rules, 2, sight, MAX)?.position).toBe(0);
    expect(nextStewardOperation(rules, 3, sight, MAX)?.position).toBe(0);
    expect(nextStewardOperation(rules, 0, sightOf(false, {}, { wheat: 50 }), MAX)).toBeNull();
    expect(nextStewardOperation([], 0, sight, MAX)).toBeNull();
  });

  const rule: fc.Arbitrary<StewardPlanRule> = fc.oneof(
    fc.constant(collect),
    fc.record({
      kind: fc.constant('sell' as const),
      goodId: fc.constantFrom('a', 'b'),
      minPriceOboles: fc.integer({ min: 1, max: 100 }),
      keepUnits: fc.integer({ min: 0, max: 50 }),
    }),
    fc.record({
      kind: fc.constant('buy' as const),
      goodId: fc.constantFrom('a', 'b'),
      maxPriceOboles: fc.integer({ min: 1, max: 100 }),
      targetUnits: fc.integer({ min: 1, max: 50 }),
    }),
  );
  const stock = fc.record({ a: fc.nat(80), b: fc.nat(80) });

  it('propriété : la règle choisie est la première, à partir du départ, qui a quelque chose à faire', () => {
    fc.assert(
      fc.property(
        fc.array(rule, { maxLength: 20 }),
        fc.nat(40),
        fc.boolean(),
        stock,
        stock,
        fc.integer({ min: 1, max: 100 }),
        (rules, start, collectable, free, incoming, max) => {
          const sight = sightOf(collectable, free, incoming);
          const next = nextStewardOperation(rules, start, sight, max);
          const active = rules.map((candidate) => ruleAction(candidate, sight, max) !== null);
          if (!active.includes(true)) return next === null;
          if (!next) return false;
          const first = start % rules.length;
          const skipped = (next.position - first + rules.length) % rules.length;
          // Toutes les règles passées n'avaient rien à faire, et l'action rendue est celle de la règle choisie.
          for (let offset = 0; offset < skipped; offset += 1)
            if (active[(first + offset) % rules.length]) return false;
          const action = next.action;
          const quantityOk =
            action.kind === 'collect' || (action.quantity >= 1 && action.quantity <= max);
          return (
            active[next.position] === true &&
            quantityOk &&
            JSON.stringify(ruleAction(rules[next.position] as StewardPlanRule, sight, max)) ===
              JSON.stringify(action)
          );
        },
      ),
    );
  });

  it('propriété : une vente garde toujours sa réserve, un rachat ne dépasse jamais le stock visé', () => {
    fc.assert(
      fc.property(rule, stock, stock, (candidate, free, incoming) => {
        const action = ruleAction(candidate, sightOf(false, free, incoming), MAX);
        if (!action || action.kind === 'collect') return true;
        if (candidate.kind === 'sell')
          return free[candidate.goodId as 'a'] - action.quantity === candidate.keepUnits;
        if (candidate.kind === 'buy')
          return incoming[candidate.goodId as 'a'] + action.quantity === candidate.targetUnits;
        return false;
      }),
    );
  });
});

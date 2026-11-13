import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyEntry,
  applyStockMovement,
  buildEntry,
  moneySupply,
  transfer,
  type Balances,
  type LedgerLine,
  type Quantities,
  type StockEnd,
} from './ledger';

const HOUSES = ['house-a', 'house-b', 'house-c', 'house-d'];
const SYSTEM = ['faucet_npc_purchases', 'sink_upkeep'];
const isSystem = (accountId: string) => SYSTEM.includes(accountId);
const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0);

const account = fc.constantFrom(...HOUSES, ...SYSTEM);
const amount = fc.integer({ min: 1, max: 1_000_000 });
/** Écriture équilibrée à n lignes : n-1 montants libres, la dernière ligne solde l'écriture. */
const balancedLines = fc
  .array(
    fc.record({ accountId: account, amount: fc.integer({ min: -1_000_000, max: 1_000_000 }) }),
    {
      minLength: 1,
      maxLength: 5,
    },
  )
  .chain((lines) =>
    account.map((accountId) => [...lines, { accountId, amount: -sum(lines.map((l) => l.amount)) }]),
  )
  .filter((lines) => lines.every((line) => line.amount !== 0));

describe('buildEntry', () => {
  it('accepte toute écriture équilibrée et la rend à l’identique', () => {
    fc.assert(
      fc.property(balancedLines, (lines) => {
        const result = buildEntry('test', lines);
        expect(result).toEqual({ ok: true, value: { kind: 'test', lines } });
      }),
    );
  });

  it('refuse toute écriture dont la somme n’est pas nulle', () => {
    fc.assert(
      fc.property(balancedLines, account, amount, (lines, accountId, extra) => {
        const unbalanced = [...lines, { accountId, amount: extra }];
        expect(buildEntry('test', unbalanced)).toEqual({ ok: false, error: 'UNBALANCED' });
      }),
    );
  });

  it('refuse tout montant non entier, nul, non fini ou hors des entiers sûrs', () => {
    const invalid = fc.oneof(
      fc.double({ noInteger: true, noNaN: true }),
      fc.constantFrom(0, Number.NaN, Infinity, -Infinity, 2 ** 53, -(2 ** 53)),
    );
    fc.assert(
      fc.property(invalid, account, account, (bad, a, b) => {
        const lines: LedgerLine[] = [
          { accountId: a, amount: bad },
          { accountId: b, amount: -bad },
        ];
        expect(buildEntry('test', lines)).toMatchObject({ ok: false, error: 'INVALID_AMOUNT' });
      }),
    );
  });

  it('refuse une écriture à moins de deux lignes et un cumul qui déborde', () => {
    expect(buildEntry('test', [])).toEqual({ ok: false, error: 'TOO_FEW_LINES' });
    expect(buildEntry('test', [{ accountId: 'a', amount: 1 }])).toEqual({
      ok: false,
      error: 'TOO_FEW_LINES',
    });
    const huge = Number.MAX_SAFE_INTEGER;
    const lines = [huge, huge, -huge, -huge].map((value) => ({ accountId: 'a', amount: value }));
    expect(buildEntry('test', lines)).toEqual({ ok: false, error: 'OVERFLOW' });
  });
});

describe('applyEntry : propriétés sur des suites aléatoires d’écritures', () => {
  const entries = fc.array(balancedLines, { maxLength: 40 });

  it('conserve la monnaie, n’autorise aucun découvert hors comptes système, et refuse sans rien changer', () => {
    fc.assert(
      fc.property(entries, (sequence) => {
        let balances: Balances = new Map();
        for (const lines of sequence) {
          const entry = buildEntry('test', lines);
          if (!entry.ok) throw new Error('générateur invalide');
          const before = new Map(balances);
          const result = applyEntry(balances, entry.value, isSystem);
          // Tout ou rien : l'état fourni n'est jamais modifié, accepté ou non.
          expect(balances).toEqual(before);
          // Oracle indépendant : soldes attendus ligne à ligne ; l'écriture est acceptée si et seulement
          // si aucune maison ne finit débitrice, et les soldes rendus sont exactement ceux attendus.
          const expected = new Map(before);
          for (const line of lines)
            expected.set(line.accountId, (expected.get(line.accountId) ?? 0) + line.amount);
          const overdrawn = HOUSES.filter((house) => (expected.get(house) ?? 0) < 0);
          expect(result.ok).toBe(overdrawn.length === 0);
          if (result.ok) {
            expect(result.value).toEqual(expected);
            balances = result.value;
          } else {
            expect(result.error).toBe('INSUFFICIENT_FUNDS');
            expect(overdrawn).toContain(result.accountId);
          }

          // Conservation : la somme de tous les soldes reste nulle.
          expect(sum(balances.values())).toBe(0);
          // Jamais de solde négatif non autorisé.
          for (const house of HOUSES) expect(balances.get(house) ?? 0).toBeGreaterThanOrEqual(0);
          // La masse monétaire est exactement ce que les comptes système ont émis, net des puits.
          expect(
            moneySupply(balances, isSystem) + sum(SYSTEM.map((key) => balances.get(key) ?? 0)),
          ).toBe(0);
        }
      }),
    );
  });

  it('un virement entre maisons ne change pas la masse monétaire ; un robinet la crée, un puits la détruit', () => {
    fc.assert(
      fc.property(amount, amount, (granted, moved) => {
        const grant = transfer('grant', 'faucet_npc_purchases', 'house-a', granted);
        if (!grant.ok) throw new Error(grant.error);
        const funded = applyEntry(new Map(), grant.value, isSystem);
        if (!funded.ok) throw new Error(funded.error);
        expect(moneySupply(funded.value, isSystem)).toBe(granted);

        const payment = transfer('pay', 'house-a', 'house-b', moved);
        if (!payment.ok) throw new Error(payment.error);
        const paid = applyEntry(funded.value, payment.value, isSystem);
        if (moved > granted) {
          expect(paid).toEqual({ ok: false, error: 'INSUFFICIENT_FUNDS', accountId: 'house-a' });
          return;
        }
        if (!paid.ok) throw new Error(paid.error);
        expect(moneySupply(paid.value, isSystem)).toBe(granted);
        expect(paid.value.get('house-b')).toBe(moved);

        const upkeep = transfer('upkeep', 'house-b', 'sink_upkeep', moved);
        if (!upkeep.ok) throw new Error(upkeep.error);
        const burned = applyEntry(paid.value, upkeep.value, isSystem);
        if (!burned.ok) throw new Error(burned.error);
        expect(moneySupply(burned.value, isSystem)).toBe(granted - moved);
      }),
    );
  });

  it('revalide l’écriture : une écriture forgée ne crée pas de monnaie', () => {
    const balances: Balances = new Map([['house-a', 100]]);
    const forged = [
      {
        kind: 'forged',
        lines: [
          { accountId: 'house-a', amount: 5 },
          { accountId: 'house-b', amount: 5 },
        ],
      },
      {
        kind: 'forged',
        lines: [
          { accountId: 'house-a', amount: -1.5 },
          { accountId: 'house-b', amount: 1.5 },
        ],
      },
      { kind: 'forged', lines: [{ accountId: 'house-a', amount: 5 }] },
    ];
    expect(forged.map((entry) => applyEntry(balances, entry, isSystem))).toMatchObject([
      { ok: false, error: 'UNBALANCED' },
      { ok: false, error: 'INVALID_AMOUNT' },
      { ok: false, error: 'TOO_FEW_LINES' },
    ]);
    expect(balances).toEqual(new Map([['house-a', 100]]));
  });

  it('refuse un solde qui sortirait des entiers sûrs, sans perte de précision silencieuse', () => {
    const balances: Balances = new Map([['house-a', Number.MAX_SAFE_INTEGER]]);
    const grant = transfer('grant', 'faucet_npc_purchases', 'house-a', 1);
    if (!grant.ok) throw new Error(grant.error);
    expect(applyEntry(balances, grant.value, isSystem)).toEqual({
      ok: false,
      error: 'OVERFLOW',
      accountId: 'house-a',
    });
    expect(
      applyStockMovement(new Map([['inv-a', Number.MAX_SAFE_INTEGER]]), {
        goodId: 'wheat',
        quantity: 1,
        from: { system: 'production' },
        to: { inventoryId: 'inv-a' },
      }),
    ).toEqual({ ok: false, error: 'OVERFLOW' });
  });

  it('refuse un virement de montant nul, négatif ou non entier', () => {
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      expect(transfer('pay', 'house-a', 'house-b', bad)).toMatchObject({
        ok: false,
        error: 'INVALID_AMOUNT',
      });
    }
  });
});

describe('applyStockMovement : propriétés', () => {
  const INVENTORIES = ['inv-a', 'inv-b', 'inv-c'];
  const end: fc.Arbitrary<StockEnd> = fc.oneof(
    fc.constantFrom(...INVENTORIES).map((inventoryId) => ({ inventoryId })),
    fc.constantFrom('production', 'npc_consumption').map((system) => ({ system })),
  );
  const movement = fc.record({
    goodId: fc.constant('wheat'),
    quantity: fc.integer({ min: 1, max: 1000 }),
    from: end,
    to: end,
  });

  it('conserve les stocks : total détenu = entrées système - sorties système, jamais de quantité négative', () => {
    fc.assert(
      fc.property(fc.array(movement, { maxLength: 60 }), (sequence) => {
        let quantities: Quantities = new Map();
        let net = 0;
        for (const step of sequence) {
          const before = new Map(quantities);
          const result = applyStockMovement(quantities, step);
          expect(quantities).toEqual(before);
          if (result.ok) {
            quantities = result.value;
            if ('system' in step.from) net += step.quantity;
            if ('system' in step.to) net -= step.quantity;
          }
          expect(sum(quantities.values())).toBe(net);
          for (const quantity of quantities.values()) expect(quantity).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it('refuse quantité invalide, mouvement sans stock réel, stock vers lui-même, stock insuffisant', () => {
    const stock: Quantities = new Map([['inv-a', 10]]);
    const move = (quantity: number, from: StockEnd, to: StockEnd) =>
      applyStockMovement(stock, { goodId: 'wheat', quantity, from, to });
    expect(move(0, { system: 'production' }, { inventoryId: 'inv-a' })).toEqual({
      ok: false,
      error: 'INVALID_QUANTITY',
    });
    expect(move(1.5, { system: 'production' }, { inventoryId: 'inv-a' })).toEqual({
      ok: false,
      error: 'INVALID_QUANTITY',
    });
    expect(move(1, { system: 'production' }, { system: 'npc_consumption' })).toEqual({
      ok: false,
      error: 'NO_INVENTORY',
    });
    expect(move(1, { inventoryId: 'inv-a' }, { inventoryId: 'inv-a' })).toEqual({
      ok: false,
      error: 'SAME_INVENTORY',
    });
    expect(move(11, { inventoryId: 'inv-a' }, { inventoryId: 'inv-b' })).toEqual({
      ok: false,
      error: 'INSUFFICIENT_STOCK',
    });
    expect(move(10, { inventoryId: 'inv-a' }, { inventoryId: 'inv-b' })).toMatchObject({
      ok: true,
    });
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { settleRents } from './rent';

const lease = (
  leaseId: string,
  tenantHouseId: string,
  landlordHouseId: string,
  rentOboles: number,
) => ({
  leaseId,
  tenantHouseId,
  landlordHouseId,
  rentOboles,
});
const houses = ['a', 'b', 'c', 'd'];
const scenario = fc.record({
  balances: fc.tuple(...houses.map(() => fc.integer({ min: 0, max: 300 }))),
  dues: fc.array(
    fc
      .record({
        tenant: fc.constantFrom(...houses),
        landlord: fc.constantFrom(...houses),
        rent: fc.oneof(fc.constantFrom(1, 100), fc.integer({ min: 1, max: 400 })),
      })
      .filter((due) => due.tenant !== due.landlord),
    { maxLength: 10 },
  ),
});
const sum = (balances: Iterable<number>) =>
  [...balances].reduce((total, value) => total + value, 0);

describe('loyers d’une clôture', () => {
  it('exemples : en entier ou pas du tout, dans l’ordre ; un loyer reçu en paie un autre plus loin', () => {
    const balances = new Map([
      ['a', 50],
      ['b', 0],
      ['c', 30],
    ]);
    const dues = [
      lease('1', 'b', 'a', 40),
      lease('2', 'a', 'b', 40),
      lease('3', 'b', 'c', 40),
      lease('4', 'c', 'a', 31),
    ];
    const settled = settleRents(balances, dues);
    // b ne peut payer d'abord ; a paie b, qui paie alors c ; c a 70 et paie a.
    expect(settled.unpaid.map((due) => due.leaseId)).toEqual(['1']);
    expect(settled.paid.map((due) => due.leaseId)).toEqual(['2', '3', '4']);
    expect(Object.fromEntries(settled.balances)).toEqual({ a: 41, b: 0, c: 39 });
    expect(Object.fromEntries(balances)).toEqual({ a: 50, b: 0, c: 30 });
    // Solde nul et loyer exact : le loyer égal à la trésorerie se paie, une obole de plus non.
    expect(
      settleRents(
        new Map([
          ['a', 7],
          ['b', 0],
        ]),
        [lease('5', 'a', 'b', 7)],
      ).paid,
    ).toHaveLength(1);
    expect(
      settleRents(
        new Map([
          ['a', 7],
          ['b', 0],
        ]),
        [lease('6', 'a', 'b', 8)],
      ).unpaid,
    ).toHaveLength(1);
    expect(settleRents(new Map(), []).paid).toEqual([]);
  });

  it('propriétés : aucune monnaie créée ni détruite, aucun solde négatif, chaque bail tranché une fois', () => {
    fc.assert(
      fc.property(scenario, ({ balances: values, dues }) => {
        const balances = new Map(houses.map((house, index) => [house, values[index] ?? 0]));
        const leases = dues.map((due, index) =>
          lease(`${index}`, due.tenant, due.landlord, due.rent),
        );
        const { paid, unpaid, balances: after } = settleRents(balances, leases);
        expect(sum(after.values())).toBe(sum(balances.values()));
        for (const value of after.values()) expect(value).toBeGreaterThanOrEqual(0);
        expect(
          [...paid, ...unpaid].map((due) => Number(due.leaseId)).sort((x, y) => x - y),
        ).toEqual(leases.map((_, index) => index));
        // Chaque maison finit avec son solde, plus les loyers reçus, moins les loyers payés.
        for (const house of houses) {
          const received = sum(
            paid.filter((due) => due.landlordHouseId === house).map((due) => due.rentOboles),
          );
          const spent = sum(
            paid.filter((due) => due.tenantHouseId === house).map((due) => due.rentOboles),
          );
          expect(after.get(house)).toBe((balances.get(house) ?? 0) + received - spent);
        }
        // Un bail impayé l'est parce que son locataire n'avait pas de quoi à son tour : rejoué seul après
        // les loyers qui le précèdent, il ne passerait pas non plus.
        for (const due of unpaid) {
          const before = leases.slice(0, Number(due.leaseId));
          const state = settleRents(balances, before).balances;
          expect(state.get(due.tenantHouseId) ?? 0).toBeLessThan(due.rentOboles);
        }
      }),
    );
  });

  it('refuse un loyer nul, négatif ou fractionnaire, un bail sans maison connue, un solde négatif', () => {
    const balances = new Map([
      ['a', 10],
      ['b', 10],
    ]);
    for (const rent of [0, -1, 1.5, Number.NaN])
      expect(() => settleRents(balances, [lease('x', 'a', 'b', rent)])).toThrow();
    expect(() => settleRents(balances, [lease('x', 'a', 'a', 1)])).toThrow();
    expect(() => settleRents(balances, [lease('x', 'a', 'z', 1)])).toThrow();
    expect(() => settleRents(new Map([['a', -1]]), [])).toThrow();
  });
});

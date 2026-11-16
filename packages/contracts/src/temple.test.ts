import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import { offeringMadeSchema, templeMakeOfferingInputSchema } from './temple';

describe('temple.makeOffering', () => {
  const valid = {
    godId: 'demeter',
    oboles: 10,
    goods: [{ goodId: 'wheat', quantity: 5 }],
    expectedCharis: 40,
  };
  const ok = (input: unknown) => templeMakeOfferingInputSchema.safeParse(input).success;

  it('dieu, oboles, biens et Charis vue ; de la monnaie ou des biens, chaque bien une fois', () => {
    expect(ok(valid)).toBe(true);
    expect(ok({ ...valid, goods: [] })).toBe(true);
    expect(ok({ ...valid, oboles: 0 })).toBe(true);
    // Une offrande vide n'est pas une offrande.
    expect(ok({ ...valid, oboles: 0, goods: [] })).toBe(false);
    expect(ok({ ...valid, goods: [...valid.goods, { goodId: 'wheat', quantity: 1 }] })).toBe(false);
    for (const oboles of [-1, 2.5, 1_000_000_001, '10'])
      expect([oboles, ok({ ...valid, oboles })]).toEqual([oboles, false]);
    for (const quantity of [0, -1, 1.5, 1_000_001])
      expect([quantity, ok({ ...valid, goods: [{ goodId: 'wheat', quantity }] })]).toEqual([
        quantity,
        false,
      ]);
    for (const expectedCharis of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect([expectedCharis, ok({ ...valid, expectedCharis })]).toEqual([expectedCharis, false]);
    expect(ok({ ...valid, godId: 'Zeus' })).toBe(false);
    // La maison est celle du compte, jamais de l'entrée ; rien ne s'offre à une autre maison.
    expect(ok({ ...valid, houseId: '01900000-0000-7000-8000-0000000000a1' })).toBe(false);
    expect(
      ok({
        ...valid,
        goods: Array.from({ length: 21 }, (_, n) => ({ goodId: `g${n}x`, quantity: 1 })),
      }),
    ).toBe(false);
  });

  it('OfferingMade se relit tel qu’il est écrit, par son schéma comme par l’union', () => {
    const made = {
      type: 'OfferingMade' as const,
      payload: {
        offeringId: '01900000-0000-7000-8000-0000000004f1',
        houseId: '01900000-0000-7000-8000-0000000000a1',
        cityId: '01900000-0000-7000-8000-000000000101',
        godId: 'demeter',
        oboles: 0,
        goods: [{ goodId: 'wheat', quantity: 5 }],
        charisGained: 30,
      },
    };
    const written = JSON.parse(JSON.stringify(made)) as unknown;
    expect(offeringMadeSchema.parse(written)).toEqual(made);
    expect(domainEventSchema.parse(written)).toEqual(made);
    expect(
      domainEventSchema.safeParse({ ...made, payload: { ...made.payload, charisGained: 0 } })
        .success,
    ).toBe(false);
  });
});

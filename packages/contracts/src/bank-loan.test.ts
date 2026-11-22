import { describe, expect, it } from 'vitest';
import {
  bankOfferLoanInputSchema,
  bankWithdrawOfferInputSchema,
  domainEventSchema,
  loanAcceptOfferInputSchema,
} from './index';

const borrowerHouseId = '01900000-0000-7000-8000-0000000728b1';
const offerId = '01900000-0000-7000-8000-0000000728d1';
const stock = {
  kind: 'stock' as const,
  cityId: '01900000-0000-7000-8000-0000000728c1',
  goodId: 'olives',
  quantity: 10,
};
const property = { kind: 'property' as const, propertyId: '01900000-0000-7000-8000-0000000728e1' };
const terms = { principal: 1000, rateBps: 1200, termDays: 30, collateral: stock };

describe('prêts gagés des banques (#728)', () => {
  it('une offre porte un emprunteur, des conditions entières et une garantie de stock ou de logement', () => {
    for (const collateral of [stock, property]) {
      const offer = { borrowerHouseId, ...terms, collateral };
      expect(bankOfferLoanInputSchema.parse(offer)).toEqual(offer);
    }
    for (const patch of [
      { principal: 0 },
      { principal: Number.MAX_SAFE_INTEGER + 1 },
      { rateBps: -1 },
      { rateBps: 1_000_001 },
      { termDays: 0 },
      { termDays: 367 },
      { termDays: 1.5 },
      { collateral: { ...stock, quantity: 0 } },
      { collateral: { ...stock, goodId: 'Olives' } },
      { collateral: { ...stock, propertyId: property.propertyId } },
      { collateral: { kind: 'ship', shipId: offerId } },
      { borrowerHouseId: undefined },
      { bankId: offerId },
    ])
      expect(
        bankOfferLoanInputSchema.safeParse({ borrowerHouseId, ...terms, ...patch }).success,
      ).toBe(false);
  });

  it('l’acceptation répète les conditions vues ; le retrait ne nomme que l’offre', () => {
    const accept = { offerId, ...terms, collateral: property };
    expect(loanAcceptOfferInputSchema.parse(accept)).toEqual(accept);
    for (const patch of [{ collateral: undefined }, { principal: undefined }, { houseId: offerId }])
      expect(loanAcceptOfferInputSchema.safeParse({ ...accept, ...patch }).success).toBe(false);
    expect(bankWithdrawOfferInputSchema.parse({ offerId })).toEqual({ offerId });
    expect(bankWithdrawOfferInputSchema.safeParse({ offerId, bankId: offerId }).success).toBe(
      false,
    );
  });

  it('LoanOffered, LoanOfferWithdrawn et LoanOfferAccepted se relisent par l’union', () => {
    const ids = { bankId: '01900000-0000-7000-8000-0000000728a9', houseId: borrowerHouseId };
    const events = [
      {
        type: 'LoanOffered' as const,
        payload: { ...ids, offerId, borrowerHouseId, ...terms, interest: 10 },
      },
      { type: 'LoanOfferWithdrawn' as const, payload: { ...ids, offerId } },
      {
        type: 'LoanOfferAccepted' as const,
        payload: {
          ...ids,
          offerId,
          loanId: '01900000-0000-7000-8000-0000000728f9',
          principal: 1000,
          rateBps: 1200,
          termDays: 30,
          interest: 10,
          outstanding: 1010,
          dueDay: 20_100,
          dueAt: '2026-12-21T03:00:00.000Z',
          collateral: stock,
        },
      },
    ];
    for (const event of events) expect(domainEventSchema.parse(event)).toEqual(event);
    const [, , acceptedEvent] = events;
    expect(
      domainEventSchema.safeParse({
        ...acceptedEvent,
        payload: { ...acceptedEvent?.payload, outstanding: 0 },
      }).success,
    ).toBe(false);
  });

  it('CollateralSeized nomme les deux maisons, la garantie et le reste dû remis (#729)', () => {
    const seized = {
      type: 'CollateralSeized' as const,
      payload: {
        loanId: '01900000-0000-7000-8000-0000000728f9',
        bankId: '01900000-0000-7000-8000-0000000728a9',
        houseId: borrowerHouseId,
        bankHouseId: '01900000-0000-7000-8000-0000000728a8',
        collateral: stock,
        writtenOff: 710,
        gameDay: 20_100,
      },
    };
    expect(domainEventSchema.parse(seized)).toEqual(seized);
    for (const patch of [{ writtenOff: 0 }, { collateral: { kind: 'site' } }, { gameDay: -1 }])
      expect(
        domainEventSchema.safeParse({ ...seized, payload: { ...seized.payload, ...patch } })
          .success,
        JSON.stringify(patch),
      ).toBe(false);
  });
});

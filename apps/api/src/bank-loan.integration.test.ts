import { randomUUID } from 'node:crypto';
import { ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  codeOf,
  newBank,
  offer,
  offered,
  statusOf,
  terms,
  vaultOf,
  withBanks,
} from './bank-loan.integration-fixtures';
import {
  db,
  eventsOf,
  KALLISTE,
  newPlayer,
  newProperty,
  owner,
  send,
} from './property.integration-fixtures';

// Offres de prêt gagé des banques (#728), contre Supabase local ; règles des banques dans les fixtures.
beforeAll(() => ensureInitialConfig(db, INITIAL_CONFIG));
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const withdrawOffer = (user: string, offerId: string) =>
  send(user, 'bank.withdrawOffer', { offerId }, undefined, withBanks(null));

describe('bank.offerLoan', () => {
  it('la banque offre ses conditions sans rien bouger, ni monnaie ni garantie', async () => {
    const bank = await newBank();
    const borrower = await newPlayer(KALLISTE);
    const done = await offer(bank.user, borrower.houseId);
    expect(done.status).toBe(200);
    const offerId = done.body.data.offerId as string;
    // 2 000 × 12 % × 30 jours ÷ 365, arrondi à l'obole supérieure.
    const data = {
      offerId,
      bankId: bank.bankId,
      borrowerHouseId: borrower.houseId,
      ...terms(),
      interest: 20,
    };
    expect(done.body.data).toEqual(data);
    expect(await eventsOf(bank.houseId, 'LoanOffered')).toEqual([
      { ...data, houseId: bank.houseId },
    ]);
    expect([await statusOf(offerId), await vaultOf(bank.bankId)]).toEqual(['open', 5_000]);
    // Un logement aussi se propose en garantie, sans que la banque sache à qui il est.
    const property = (
      await offer(bank.user, borrower.houseId, {
        collateral: { kind: 'property', propertyId: await newProperty(KALLISTE) },
      })
    ).status;
    expect(property).toBe(200);
  });

  it('refusée sans banques, sans banque, à sa maison, à une inconnue, hors des bornes ou sans garantie', async () => {
    const bank = await newBank();
    const borrower = await newPlayer(KALLISTE);
    const noBank = await newPlayer(KALLISTE);
    const unknownId = randomUUID();
    const cases: [string, ReturnType<typeof offer>][] = [
      ['BANKS_CLOSED', offer(bank.user, borrower.houseId, {}, withBanks(null))],
      ['BANK_NOT_FOUND', offer(noBank.user, borrower.houseId)],
      ['OWN_HOUSE', offer(bank.user, bank.houseId)],
      ['BORROWER_NOT_FOUND', offer(bank.user, unknownId)],
      ['RATE_OUT_OF_BOUNDS', offer(bank.user, borrower.houseId, { rateBps: 299 })],
      ['RATE_OUT_OF_BOUNDS', offer(bank.user, borrower.houseId, { rateBps: 5_001 })],
      [
        'COLLATERAL_NOT_FOUND',
        offer(bank.user, borrower.houseId, {
          collateral: { kind: 'stock', cityId: KALLISTE, goodId: 'nectar', quantity: 1 },
        }),
      ],
      [
        'COLLATERAL_NOT_FOUND',
        offer(bank.user, borrower.houseId, {
          collateral: { kind: 'stock', cityId: unknownId, goodId: 'wheat', quantity: 1 },
        }),
      ],
      [
        'COLLATERAL_NOT_FOUND',
        offer(bank.user, borrower.houseId, {
          collateral: { kind: 'property', propertyId: unknownId },
        }),
      ],
    ];
    for (const [code, reply] of cases) expect(codeOf(await reply)).toBe(code);
    expect(await eventsOf(bank.houseId, 'LoanOffered')).toEqual([]);
  });
});

describe('bank.withdrawOffer', () => {
  it('la banque retire une offre ouverte, une fois, même banques fermées ; une autre maison ne la connaît pas', async () => {
    const bank = await newBank();
    const other = await newBank();
    const borrower = await newPlayer(KALLISTE);
    const offerId = await offered(bank.user, borrower.houseId);
    expect(codeOf(await withdrawOffer(other.user, offerId))).toBe('OFFER_NOT_FOUND');
    expect(codeOf(await withdrawOffer(borrower.user, offerId))).toBe('OFFER_NOT_FOUND');
    const done = await withdrawOffer(bank.user, offerId);
    expect(done.body.data).toEqual({ offerId, bankId: bank.bankId });
    expect(await statusOf(offerId)).toBe('withdrawn');
    expect(codeOf(await withdrawOffer(bank.user, offerId))).toBe('OFFER_CLOSED');
    expect(await eventsOf(bank.houseId, 'LoanOfferWithdrawn')).toEqual([
      { offerId, bankId: bank.bankId, houseId: bank.houseId },
    ]);
  });
});

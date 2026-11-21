import { randomUUID } from 'node:crypto';
import { ensureInitialConfig, INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accept,
  codeOf,
  heldOf,
  loanOf,
  newBank,
  offered,
  statusOf,
  vaultOf,
} from './bank-loan.integration-fixtures';
import {
  balanceOf,
  db,
  eventsOf,
  give,
  GRANT,
  KALLISTE,
  newPlayer,
  owner,
} from './property.integration-fixtures';

// Acceptation d'une offre de prêt gagé (#728), contre Supabase local ; règles des banques dans les fixtures. La base
// date le prêt à l'horloge de sa configuration en vigueur : celle de la configuration initiale.
beforeAll(() => ensureInitialConfig(db, INITIAL_CONFIG));
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const clock = (INITIAL_CONFIG as GameConfig).clock;
/** Un emprunteur de Kallistè et ses 50 blés. */
async function newBorrower() {
  const player = await newPlayer(KALLISTE);
  await give(player.houseId, 'wheat', 50);
  return player;
}

describe('loan.acceptOffer', () => {
  it('le principal passe du coffre à l’emprunteur, la garantie est bloquée ; rejouable, une fois', async () => {
    const bank = await newBank();
    const borrower = await newBorrower();
    const offerId = await offered(bank.user, borrower.houseId);
    const key = randomUUID();
    const done = await accept(borrower.user, offerId, {}, key);
    expect(done.status).toBe(200);
    const dueDay = gameDayAt(new Date(), clock) + 30;
    const data = {
      loanId: done.body.data.loanId as string,
      offerId,
      bankId: bank.bankId,
      principal: 2_000,
      rateBps: 1_200,
      termDays: 30,
      interest: 20,
      outstanding: 2_020,
      dueDay,
      dueAt: dailyCloseAt(dueDay, clock).toISOString(),
    };
    expect(done.body.data).toEqual(data);
    expect(await accept(borrower.user, offerId, {}, key)).toEqual(done);
    expect(codeOf(await accept(borrower.user, offerId))).toBe('OFFER_CLOSED');
    expect([
      await vaultOf(bank.bankId),
      await balanceOf(borrower.houseId),
      await heldOf(borrower.houseId),
      await loanOf(offerId),
      await statusOf(offerId),
    ]).toEqual([3_000, GRANT + 2_000, '50/20', 'bank:active:2000:20:2020', 'accepted']);
    const [event] = await eventsOf(borrower.houseId, 'LoanOfferAccepted');
    expect(event).toMatchObject({
      ...data,
      houseId: borrower.houseId,
      collateral: { quantity: 20 },
    });
  });
});

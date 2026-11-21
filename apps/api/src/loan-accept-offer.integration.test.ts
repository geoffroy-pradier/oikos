import { randomUUID } from 'node:crypto';
import { ensureInitialConfig, INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accept,
  app,
  codeOf,
  heldOf,
  loanOf,
  newBank,
  offered,
  statusOf,
  vaultOf,
  withBanks,
} from './bank-loan.integration-fixtures';
import {
  balanceOf,
  db,
  ELAIA,
  eventsOf,
  give,
  GRANT,
  KALLISTE,
  newOwner,
  newPlayer,
  owner,
  send,
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

  it('un logement se gage, une fois', async () => {
    const bank = await newBank();
    const borrower = await newOwner(KALLISTE);
    const collateral = { kind: 'property', propertyId: borrower.propertyId };
    const first = await offered(bank.user, borrower.houseId, { collateral });
    const second = await offered(bank.user, borrower.houseId, { collateral, principal: 100 });
    expect((await accept(borrower.user, first, { collateral })).status).toBe(200);
    // La base refuse toute offre du logement gagé, que la commande traduit.
    const sale = { propertyId: borrower.propertyId, priceOboles: 500 };
    expect(codeOf(await send(borrower.user, 'property.listForSale', sale))).toBe(
      'PROPERTY_PLEDGED',
    );
    expect(codeOf(await accept(borrower.user, second, { collateral, principal: 100 }))).toBe(
      'COLLATERAL_NOT_FREE',
    );
    const stranger = await newPlayer(KALLISTE);
    const theirs = await offered(bank.user, stranger.houseId, { collateral, principal: 100 });
    expect(codeOf(await accept(stranger.user, theirs, { collateral, principal: 100 }))).toBe(
      'COLLATERAL_NOT_FREE',
    );
  });

  it('refusée sans rien bouger : offre d’une autre, conditions changées, banques fermées, garantie, déshonneur', async () => {
    const bank = await newBank();
    const borrower = await newBorrower();
    const offerId = await offered(bank.user, borrower.houseId);
    const stranger = await newBorrower();
    const oil = { kind: 'stock', cityId: KALLISTE, goodId: 'olive_oil', quantity: 1 };
    const unheld = await offered(bank.user, borrower.houseId, { collateral: oil });
    const elsewhere = { kind: 'stock', cityId: ELAIA, goodId: 'wheat', quantity: 20 };
    const away = await offered(bank.user, borrower.houseId, { collateral: elsewhere });
    const cases: [string, Promise<{ body: { error?: { code: string } } }>][] = [
      ['OFFER_NOT_FOUND', accept(stranger.user, offerId)],
      ['OFFER_NOT_FOUND', accept(borrower.user, randomUUID())],
      ['TERMS_CHANGED', accept(borrower.user, offerId, { principal: 1_999 })],
      ['TERMS_CHANGED', accept(borrower.user, offerId, { rateBps: 1_100 })],
      ['TERMS_CHANGED', accept(borrower.user, offerId, { termDays: 31 })],
      [
        'TERMS_CHANGED',
        accept(borrower.user, offerId, {
          collateral: { kind: 'stock', cityId: KALLISTE, goodId: 'wheat', quantity: 19 },
        }),
      ],
      ['BANKS_CLOSED', accept(borrower.user, offerId, {}, undefined, withBanks(null))],
      ['COLLATERAL_NOT_FREE', accept(borrower.user, unheld, { collateral: oil })],
      ['COLLATERAL_NOT_FREE', accept(borrower.user, away, { collateral: elsewhere })],
    ];
    for (const [code, reply] of cases) expect(codeOf(await reply)).toBe(code);
    // Une maison marquée par un prêt du temple en défaut n'emprunte pas non plus à une banque.
    const temple = await send(
      borrower.user,
      'loan.borrowFromTemple',
      { principal: 100, termDays: 7, expectedRateBps: 1_000 },
      undefined,
      app,
    );
    await owner.transaction().execute(async (trx) => {
      await sql`set local session_replication_role = replica`.execute(trx);
      await sql`update game.loans set status = 'defaulted', defaulted_day = due_day
        where id = ${temple.body.data.loanId as string}`.execute(trx);
    });
    expect(codeOf(await accept(borrower.user, offerId))).toBe('DISHONORED');
    expect([
      await vaultOf(bank.bankId),
      await balanceOf(borrower.houseId),
      await heldOf(borrower.houseId),
      await statusOf(offerId),
    ]).toEqual([5_000, GRANT + 100, '50/0', 'open']);
  });

  it('la réserve exigée borne le prêt, à l’obole près, dépôts compris', async () => {
    // Coffre de 2 700 : 1 700 de capital et 1 000 déposés ; réserve : le plus grand de 1 500 et de 20 % de 1 000.
    const bank = await newBank(1_700);
    const depositor = await newPlayer(ELAIA);
    await send(
      depositor.user,
      'bank.deposit',
      { bankId: bank.bankId, amount: 1_000, expectedRateBps: 100 },
      undefined,
      app,
    );
    const borrower = await newBorrower();
    const over = await offered(bank.user, borrower.houseId, { principal: 1_201 });
    const reply = await accept(borrower.user, over, { principal: 1_201 });
    expect(reply.body.error).toEqual({
      code: 'RESERVE_SHORT',
      message: 'This bank may lend at most 1200 oboles.',
    });
    const exact = await offered(bank.user, borrower.houseId, { principal: 1_200 });
    expect((await accept(borrower.user, exact, { principal: 1_200 })).status).toBe(200);
    expect(await vaultOf(bank.bankId)).toBe(1_500);
    // À la réserve, le coffre ne prête plus rien, pas même une obole.
    const one = await offered(bank.user, borrower.houseId, {
      principal: 1,
      collateral: { kind: 'stock', cityId: KALLISTE, goodId: 'wheat', quantity: 1 },
    });
    expect(
      codeOf(
        await accept(borrower.user, one, {
          principal: 1,
          collateral: { kind: 'stock', cityId: KALLISTE, goodId: 'wheat', quantity: 1 },
        }),
      ),
    ).toBe('RESERVE_SHORT');
  });
});

describe('loan.repay d’un prêt de banque', () => {
  it('intérêts d’abord, tout au coffre, même banques fermées ; au solde, la garantie se libère', async () => {
    const bank = await newBank();
    const borrower = await newBorrower();
    const offerId = await offered(bank.user, borrower.houseId);
    const loanId = (await accept(borrower.user, offerId)).body.data.loanId as string;
    const repay = (amount: number, via = app) =>
      send(borrower.user, 'loan.repay', { loanId, amount }, undefined, via);
    expect((await repay(15, withBanks(null))).body.data).toEqual({
      loanId,
      interest: 15,
      principal: 0,
      outstanding: 2_005,
      status: 'active',
    });
    expect(codeOf(await repay(2_006))).toBe('ABOVE_OUTSTANDING');
    expect([await vaultOf(bank.bankId), await heldOf(borrower.houseId)]).toEqual([3_015, '50/20']);
    expect((await repay(2_005)).body.data).toMatchObject({
      interest: 5,
      principal: 2_000,
      status: 'repaid',
    });
    // La monnaie est revenue au coffre avec l'intérêt, sans création ni destruction ; le stock gagé est libre.
    expect([
      await vaultOf(bank.bankId),
      await balanceOf(borrower.houseId),
      await heldOf(borrower.houseId),
      await loanOf(offerId),
    ]).toEqual([5_020, GRANT - 20, '50/0', 'bank:repaid:2000:20:0']);
    const { rows } = await sql<{ line: string }>`select case when a.bank_id is not null then 'vault'
        else a.kind end || ':' || l.amount as line from game.ledger_entries e
      join game.ledger_lines l on l.entry_id = e.id join game.accounts a on a.id = l.account_id
      where e.kind = 'bank.loan_repay' and e.meta ->> 'loanId' = ${loanId} order by e.created_at, l.amount`.execute(
      owner,
    );
    expect(rows.map((row) => row.line)).toEqual([
      'house:-15',
      'vault:15',
      'house:-2005',
      'vault:2005',
    ]);
    expect(codeOf(await repay(1))).toBe('LOAN_REPAID');
  });
});

describe('loan.acceptOffer sous exécutions concurrentes', () => {
  it('une offre acceptée deux fois, ou acceptée et retirée à la fois, ne prête qu’une fois', async () => {
    const bank = await newBank();
    const borrower = await newBorrower();
    const twice = await offered(bank.user, borrower.houseId);
    const replies = await Promise.all([accept(borrower.user, twice), accept(borrower.user, twice)]);
    expect(replies.map((reply) => codeOf(reply) ?? 'ok').sort()).toEqual(['OFFER_CLOSED', 'ok']);
    const raced = await offered(bank.user, borrower.houseId);
    const [accepted, withdrawn] = await Promise.all([
      accept(borrower.user, raced),
      send(bank.user, 'bank.withdrawOffer', { offerId: raced }, undefined, app),
    ]);
    // L'une passe, l'autre trouve l'offre fermée, jamais les deux.
    expect([accepted.status === 200, withdrawn.status === 200].filter(Boolean)).toHaveLength(1);
    const loans = accepted.status === 200 ? 2 : 1;
    expect(await vaultOf(bank.bankId)).toBe(5_000 - loans * 2_000);
    expect(await heldOf(borrower.houseId)).toBe(`50/${loans * 20}`);
  });

  it('deux prêts qui dépassent ensemble la réserve, ou le même stock, ne passent pas tous deux', async () => {
    const bank = await newBank(3_500);
    const [a, b] = await Promise.all([newBorrower(), newBorrower()]);
    const [first, second] = [
      await offered(bank.user, a.houseId),
      await offered(bank.user, b.houseId),
    ];
    const reserve = await Promise.all([accept(a.user, first), accept(b.user, second)]);
    expect(reserve.map((reply) => codeOf(reply) ?? 'ok').sort()).toEqual(['RESERVE_SHORT', 'ok']);
    expect(await vaultOf(bank.bankId)).toBe(1_500);
    const rich = await newBank();
    const stock = { kind: 'stock', cityId: KALLISTE, goodId: 'wheat', quantity: 30 };
    const [one, two] = [
      await offered(rich.user, a.houseId, { principal: 100, collateral: stock }),
      await offered(rich.user, a.houseId, { principal: 100, collateral: stock }),
    ];
    const pledged = await Promise.all([
      accept(a.user, one, { principal: 100, collateral: stock }),
      accept(a.user, two, { principal: 100, collateral: stock }),
    ]);
    expect(pledged.map((reply) => codeOf(reply) ?? 'ok').sort()).toEqual([
      'COLLATERAL_NOT_FREE',
      'ok',
    ]);
    expect(await heldOf(a.houseId)).toBe(reserve[0]?.status === 200 ? '50/50' : '50/30');
  });
});

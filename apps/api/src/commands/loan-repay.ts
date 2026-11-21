import {
  LOAN_REPAY_ERROR_CODES,
  loanRepayInputSchema,
  loanRepayOutputSchema,
} from '@oikos/contracts';
import { gameDayAt, splitLoanRepayment } from '@oikos/sim';
import { defineCommand } from '../registry';
import { lock, lockHouse, refuse, systemAccount } from './loan-borrow';

const NO_FUNDS = { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' };
const ABOVE = { code: 'ABOVE_OUTSTANDING', message: 'This is more than the loan still owes.' };

/**
 * La maison rembourse une part de son prêt du temple (#724) : les intérêts d'abord (`splitLoanRepayment`), au puits
 * `sink_temple_interest`, puis le principal, qui recrédite le robinet `faucet_temple_loans`, en une écriture
 * `loan.repay` (natures 4.1 `interest` et `loans`) ; la base l'applique au prêt. Refusée pour le prêt d'une autre
 * maison, un prêt remboursé, au-delà du reste dû ou de la trésorerie.
 */
export const loanRepay = defineCommand({
  name: 'loan.repay',
  input: loanRepayInputSchema,
  output: loanRepayOutputSchema,
  errors: LOAN_REPAY_ERROR_CODES,
  // La base fait foi sous concurrence : ni découvert, ni plus que le reste dû.
  errorByConstraint: { accounts_no_overdraft: NO_FUNDS, loans_outstanding_rule: ABOVE },
  async handler({ trx, userId, emit, config, now }, input) {
    // Ordre des verrous : la maison, puis l'agora du monde et la trésorerie, comme `liturgy.perform`. La maison
    // verrouillée fait se suivre les remboursements d'un même prêt, que la base relit de toute façon.
    const house = await lockHouse(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const loan = await trx
      .selectFrom('game.loans')
      .select(['id', 'interest', 'interest_repaid', 'outstanding', 'status'])
      .where('id', '=', input.loanId)
      .where('borrower_house_id', '=', house.id)
      // Les prêts de banque (#728) se rembourseront à leur coffre : d'ici là, seul le temple est remboursé.
      .where('lender', '=', 'temple')
      .executeTakeFirst();
    if (!loan) return refuse('LOAN_NOT_FOUND', 'This house has no such loan.');
    if (loan.status === 'repaid') return refuse('LOAN_REPAID', 'This loan is already repaid.');
    const amount = BigInt(input.amount);
    if (amount > BigInt(loan.outstanding))
      return refuse(ABOVE.code, `This loan still owes ${loan.outstanding} oboles.`);
    await lock(trx, `market:${house.world_id}`);
    const treasury = await trx
      .selectFrom('game.accounts')
      .select(['id', 'balance'])
      .where('house_id', '=', house.id)
      .where('kind', '=', 'house')
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (BigInt(treasury.balance) < amount) return refuse(NO_FUNDS.code, NO_FUNDS.message);
    const split = splitLoanRepayment(amount, BigInt(loan.interest) - BigInt(loan.interest_repaid));
    const [sink, faucet] = await Promise.all([
      systemAccount(trx, house.world_id, 'sink_temple_interest'),
      systemAccount(trx, house.world_id, 'faucet_temple_loans'),
    ]);
    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({
        world_id: house.world_id,
        kind: 'loan.repay',
        meta: JSON.stringify({ loanId: loan.id, houseId: house.id }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('game.ledger_lines')
      .values(
        [
          { entry_id: entry.id, account_id: treasury.id, amount: -input.amount },
          { entry_id: entry.id, account_id: sink.id, amount: Number(split.interest) },
          { entry_id: entry.id, account_id: faucet.id, amount: Number(split.principal) },
        ].filter((line) => line.amount !== 0),
      )
      .execute();
    await trx
      .insertInto('game.loan_repayments')
      .values({
        world_id: house.world_id,
        loan_id: loan.id,
        house_id: house.id,
        interest: Number(split.interest),
        principal: Number(split.principal),
        game_day: gameDayAt(now, config.clock),
        ledger_entry_id: entry.id,
      })
      .execute();
    const after = await trx
      .selectFrom('game.loans')
      .select(['outstanding', 'status'])
      .where('id', '=', loan.id)
      .executeTakeFirstOrThrow();

    const repaid = {
      loanId: loan.id,
      interest: Number(split.interest),
      principal: Number(split.principal),
      outstanding: Number(after.outstanding),
      status: after.status,
    };
    emit({ type: 'LoanRepaid', payload: { ...repaid, houseId: house.id } });
    return { ok: true, data: repaid };
  },
});

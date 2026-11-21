import {
  LOAN_REPAY_ERROR_CODES,
  loanRepayInputSchema,
  loanRepayOutputSchema,
} from '@oikos/contracts';
import { lockBankVault, type Db } from '@oikos/db';
import { gameDayAt, splitLoanRepayment } from '@oikos/sim';
import { defineCommand } from '../registry';
import { lock, lockHouse, refuse, systemAccount } from './loan-borrow';

const NO_FUNDS = { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' };
const ABOVE = { code: 'ABOVE_OUTSTANDING', message: 'This is more than the loan still owes.' };

/** Lignes créditrices d'un remboursement au temple : les intérêts au puits, le principal au robinet. */
async function toTemple(trx: Db, worldId: string, split: { interest: bigint; principal: bigint }) {
  const [sink, faucet] = await Promise.all([
    systemAccount(trx, worldId, 'sink_temple_interest'),
    systemAccount(trx, worldId, 'faucet_temple_loans'),
  ]);
  return [
    { account_id: sink.id, amount: Number(split.interest) },
    { account_id: faucet.id, amount: Number(split.principal) },
  ];
}
/** Ligne créditrice d'un remboursement à une banque (#728) : tout au coffre, verrouillé après la trésorerie. */
async function toVault(trx: Db, bankId: string, amount: number) {
  const vault = await lockBankVault(trx, bankId);
  if (!vault) throw new Error(`Bank ${bankId} has no vault`);
  return [{ account_id: vault.accountId, amount }];
}

/**
 * La maison rembourse une part de son prêt du temple (#724) : les intérêts d'abord (`splitLoanRepayment`), au puits
 * `sink_temple_interest`, puis le principal, qui recrédite le robinet `faucet_temple_loans`, en une écriture
 * `loan.repay` (natures 4.1 `interest` et `loans`) ; la base l'applique au prêt. Un prêt de banque (#728) se rembourse
 * tout entier au coffre de sa banque, par une écriture `bank.loan_repay`, même sans section `banks` ; soldé, il libère
 * sa garantie. Refusée pour le prêt d'une autre maison, un prêt remboursé, au-delà du reste dû ou de la trésorerie.
 */
export const loanRepay = defineCommand({
  name: 'loan.repay',
  input: loanRepayInputSchema,
  output: loanRepayOutputSchema,
  errors: LOAN_REPAY_ERROR_CODES,
  // La base fait foi sous concurrence : ni découvert, ni plus que le reste dû.
  errorByConstraint: { accounts_no_overdraft: NO_FUNDS, loans_outstanding_rule: ABOVE },
  async handler({ trx, userId, emit, configAt, now }, input) {
    // Horloge de la version en vigueur à l'instant de la base, qui date le remboursement comme la base le vérifie (#725).
    const config = await configAt(now);
    // Ordre des verrous : la maison, puis l'agora du monde, le prêt et la trésorerie, comme `liturgy.perform`. Le prêt
    // est lu sous l'agora, que la clôture tient pendant son prélèvement (#725), et verrouillé : un prélèvement ou un
    // remboursement validé entre-temps est relu, et le partage se fait sur ce qui reste des intérêts.
    const house = await lockHouse(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    await lock(trx, `market:${house.world_id}`);
    const loan = await trx
      .selectFrom('game.loans')
      .select(['id', 'interest', 'interest_repaid', 'outstanding', 'status', 'bank_id'])
      .where('id', '=', input.loanId)
      .where('borrower_house_id', '=', house.id)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (!loan) return refuse('LOAN_NOT_FOUND', 'This house has no such loan.');
    if (loan.status === 'repaid') return refuse('LOAN_REPAID', 'This loan is already repaid.');
    const amount = BigInt(input.amount);
    if (amount > BigInt(loan.outstanding))
      return refuse(ABOVE.code, `This loan still owes ${loan.outstanding} oboles.`);
    const treasury = await trx
      .selectFrom('game.accounts')
      .select(['id', 'balance'])
      .where('house_id', '=', house.id)
      .where('kind', '=', 'house')
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (BigInt(treasury.balance) < amount) return refuse(NO_FUNDS.code, NO_FUNDS.message);
    const split = splitLoanRepayment(amount, BigInt(loan.interest) - BigInt(loan.interest_repaid));
    const lines = loan.bank_id
      ? await toVault(trx, loan.bank_id, input.amount)
      : await toTemple(trx, house.world_id, split);
    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({
        world_id: house.world_id,
        kind: loan.bank_id ? 'bank.loan_repay' : 'loan.repay',
        meta: JSON.stringify({
          loanId: loan.id,
          houseId: house.id,
          ...(loan.bank_id && { bankId: loan.bank_id }),
        }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // Le crédit d'abord : la base juge le découvert à chaque ligne insérée.
    await trx
      .insertInto('game.ledger_lines')
      .values(
        [...lines, { account_id: treasury.id, amount: -input.amount }]
          .filter((line) => line.amount !== 0)
          .map((line) => ({ ...line, entry_id: entry.id })),
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

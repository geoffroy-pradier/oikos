import {
  LOAN_BORROW_ERROR_CODES,
  loanBorrowFromTempleInputSchema,
  loanBorrowFromTempleOutputSchema,
} from '@oikos/contracts';
import { accountHouseId } from '@oikos/operations';
import { DEFAULT_DISHONOR_DAYS } from '@oikos/config';
import {
  dailyCloseAt,
  dishonorMark,
  gameDayAt,
  templeLoanCap,
  templeLoanInterest,
} from '@oikos/sim';
import { sql } from 'kysely';
import type { Db } from '@oikos/db';
import { defineCommand, type CommandResult } from '../registry';

export const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});
const OUTSTANDING = { code: 'LOAN_OUTSTANDING', message: 'This house already has a temple loan.' };

/** La maison du compte, verrouillée comme par `site.acquire` : ses emprunts et ses remboursements se suivent. */
export const lockHouse = (trx: Db, userId: string) =>
  trx
    .selectFrom('game.houses')
    .select(['id', 'world_id'])
    .where('id', '=', accountHouseId(userId))
    .forNoKeyUpdate()
    .executeTakeFirst();
export const lock = (trx: Db, key: string) =>
  sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
export const systemAccount = (trx: Db, worldId: string, key: string) =>
  trx
    .selectFrom('game.accounts')
    .select('id')
    .where('world_id', '=', worldId)
    .where('system_key', '=', key)
    .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no ${key}`));

/**
 * Prêts d'une maison encore dus, ou soldés après un défaut, et sa marque de déshonneur au jour `gameDay` (#725) : ceux-ci
 * marquent encore `dishonorDays` jours après leur solde, le jour de leur dernier remboursement. Partagé par
 * `loan.acceptOffer` (#728), puisque la marque refuse tout nouvel emprunt.
 */
export async function houseDishonor(
  trx: Db,
  houseId: string,
  gameDay: number,
  dishonorDays: number,
) {
  const loans = await trx
    .selectFrom('game.loans')
    .select(['lender', 'status', 'defaulted_day'])
    .select(
      sql<
        number | null
      >`(select max(r.game_day) from game.loan_repayments r where r.loan_id = game.loans.id)`.as(
        'repaid_day',
      ),
    )
    .where('borrower_house_id', '=', houseId)
    .where((eb) => eb.or([eb('status', '<>', 'repaid'), eb('defaulted_day', 'is not', null)]))
    .execute();
  const mark = dishonorMark(
    loans.map((loan) => ({
      status: loan.status,
      defaultedDay: loan.defaulted_day,
      repaidDay: loan.status === 'repaid' ? loan.repaid_day : null,
    })),
    gameDay,
    dishonorDays,
  );
  return { loans, mark };
}
export const dishonorMessage = (untilDay: number | null) =>
  untilDay === null
    ? 'This house is dishonored by a defaulted loan.'
    : `This house is dishonored until game day ${untilDay}.`;

/**
 * La maison emprunte au Trésor du temple (docs/specs/05-economie.md, 5.4 ; #724) : un principal, pour une durée admise,
 * au taux directeur en vigueur, que le joueur a vu ; l'intérêt simple est fixé pour toute la durée
 * (`templeLoanInterest`). Le principal est créé par le robinet `faucet_temple_loans` dans sa trésorerie, en une écriture
 * `loan.temple_disburse` (nature 4.1 `loans`), dans une transaction, une fois. Refusée sans Trésor du temple, à un autre
 * taux, pour une autre durée, sous une marque de déshonneur (un prêt en défaut, ou soldé depuis moins de
 * `dishonorDays` jours, `dishonorMark`, #725), avec un prêt du temple en cours ou au-delà du plafond du palier de Timè de
 * la maison (`templeLoanCap`).
 */
export const loanBorrowFromTemple = defineCommand({
  name: 'loan.borrowFromTemple',
  input: loanBorrowFromTempleInputSchema,
  output: loanBorrowFromTempleOutputSchema,
  errors: LOAN_BORROW_ERROR_CODES,
  // La base fait foi sous concurrence : un prêt du temple à la fois.
  errorByConstraint: { loans_one_temple_loan: OUTSTANDING },
  async handler({ trx, userId, emit, configAt, now }, input) {
    // Règles et horloge de la version en vigueur à l'instant de la base, que la base relit pour dater le prêt (#725).
    const config = await configAt(now);
    // Verrous : la maison, sa Timè (`honor:<maison>`), puis l'agora ; trésorerie et robinet par les lignes de l'écriture.
    const house = await lockHouse(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const rules = config.templeTreasury;
    if (!rules) return refuse('TEMPLE_CLOSED', 'The temple treasury does not lend.');
    if (input.expectedRateBps !== rules.policyRateBps)
      return refuse('RATE_CHANGED', `The policy rate is ${rules.policyRateBps} basis points.`);
    if (!rules.termDays.includes(input.termDays))
      return refuse('TERM_NOT_OFFERED', 'The temple does not lend for this term.');
    await lock(trx, `honor:${house.id}`);
    const borrowedDay = gameDayAt(now, config.clock);
    const { loans, mark } = await houseDishonor(
      trx,
      house.id,
      borrowedDay,
      rules.dishonorDays ?? DEFAULT_DISHONOR_DAYS,
    );
    if (mark.dishonored) return refuse('DISHONORED', dishonorMessage(mark.untilDay));
    if (loans.some((loan) => loan.lender === 'temple' && loan.status !== 'repaid'))
      return refuse(OUTSTANDING.code, OUTSTANDING.message);
    const honor = await trx
      .selectFrom('game.honor')
      .select('honor')
      .where('house_id', '=', house.id)
      .executeTakeFirst();
    const cap = templeLoanCap(Number(honor?.honor ?? 0), rules.principalCaps);
    if (input.principal > cap)
      return refuse('ABOVE_CAP', `This house may borrow at most ${cap} oboles.`);

    const principal = BigInt(input.principal);
    const interest = templeLoanInterest(principal, rules.policyRateBps, input.termDays);
    const dueDay = borrowedDay + input.termDays;
    const dueAt = dailyCloseAt(dueDay, config.clock);
    await lock(trx, `market:${house.world_id}`);
    const treasury = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('house_id', '=', house.id)
      .where('kind', '=', 'house')
      .executeTakeFirstOrThrow();
    const faucet = await systemAccount(trx, house.world_id, 'faucet_temple_loans');
    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({
        world_id: house.world_id,
        kind: 'loan.temple_disburse',
        meta: JSON.stringify({ houseId: house.id }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('game.ledger_lines')
      .values([
        { entry_id: entry.id, account_id: faucet.id, amount: -input.principal },
        { entry_id: entry.id, account_id: treasury.id, amount: input.principal },
      ])
      .execute();
    const loan = await trx
      .insertInto('game.loans')
      .values({
        world_id: house.world_id,
        lender: 'temple',
        borrower_house_id: house.id,
        principal: input.principal,
        rate_bps: rules.policyRateBps,
        term_days: input.termDays,
        interest: Number(interest),
        borrowed_day: borrowedDay,
        due_day: dueDay,
        due_at: dueAt,
        disbursement_entry_id: entry.id,
      })
      .returning(['id', 'outstanding'])
      .executeTakeFirstOrThrow();

    const disbursed = {
      loanId: loan.id,
      principal: input.principal,
      rateBps: rules.policyRateBps,
      termDays: input.termDays,
      interest: Number(interest),
      outstanding: Number(loan.outstanding),
      dueDay,
      dueAt: dueAt.toISOString(),
    };
    emit({
      type: 'LoanDisbursed',
      payload: { ...disbursed, houseId: house.id, lender: 'temple' },
    });
    return { ok: true, data: disbursed };
  },
});

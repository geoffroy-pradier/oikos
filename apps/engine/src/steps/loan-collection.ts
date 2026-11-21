import { DEFAULT_LOAN_DEFAULT_HONOR_LOSS } from '@oikos/config';
import { loanCollectedSchema, loanDefaultedSchema, type DomainEvent } from '@oikos/contracts';
import { recordHonorChange, type Db } from '@oikos/db';
import { collectDueLoans, honorChange } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseContext, CloseStep } from '../close';
import { lockUpkeepSinks } from './site-upkeep';

const lockKey = (trx: Db, key: string) =>
  sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
const record = (trx: Db, event: DomainEvent) =>
  trx
    .insertInto('game.domain_events')
    .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
    .execute();
/** Perte de Timè d'un défaut, ou rien sans Timè dans la version (comme pour une dérobade, `liturgyEvasion`). */
const lossOf = ({ config }: CloseContext) =>
  config.honor === undefined
    ? 0
    : (config.templeTreasury?.defaultHonorLoss ?? DEFAULT_LOAN_DEFAULT_HONOR_LOSS);
/** Prêts du temple d'un monde échus à l'instant de la clôture et encore dus, en cours (`active`) ou en défaut. */
const dueLoans = ({ trx, worldId, closeAt }: CloseContext) =>
  trx
    .selectFrom('game.loans')
    .select(['id', 'borrower_house_id', 'interest', 'interest_repaid', 'outstanding', 'status'])
    .where('world_id', '=', worldId)
    .where('lender', '=', 'temple')
    .where('status', 'in', ['active', 'defaulted'])
    .where('due_at', '<=', closeAt);

/**
 * Échéance des prêts du temple (5.4, #725), après le prélèvement d'office des liturgies et avant l'entretien : chaque
 * prêt échu à l'instant de la clôture et encore dû prend sur la trésorerie de son emprunteur, hors séquestre, ce qu'elle
 * couvre, intérêts d'abord (`collectDueLoans`), par une écriture `loan.collect` (aucune s'il n'y a rien à prendre) ; ce
 * qui reste dû reste dû, sans intérêt de plus, et se prélève aux clôtures suivantes. Un prêt en cours qui reste dû passe
 * en défaut : événement `LoanDefaulted`, perte de Timè `templeTreasury.defaultHonorLoss` (motif `loan_defaulted`,
 * rognée aux bornes de la Timè), marque de déshonneur. Verrous : l'agora, les puits de l'entretien, les trésoreries par
 * identifiant, puis les prêts ; la base n'admet qu'un prélèvement par prêt et par jour, dans la transaction qui
 * enregistre la clôture de son jour : rejouée, la clôture ne prélève rien deux fois. Elle écrit la Timè perdue après
 * l'agora : l'étape qui en prend les verrous avant elle, et sa place dans la clôture, viennent ensuite.
 */
export const loanCollection: CloseStep = {
  name: 'loanCollection',
  async run(context) {
    const { trx, worldId, gameDay, config, at } = context;
    const summary = { collected: 0, collectedOboles: 0, defaulted: 0, honorLost: 0 };
    await lockKey(trx, `market:${worldId}`);
    const seen = await dueLoans(context).execute();
    if (seen.length === 0) return summary;
    await lockUpkeepSinks(trx, worldId);
    const treasuries = await trx
      .selectFrom('game.accounts')
      .select(['id', 'house_id', 'balance'])
      .where('kind', '=', 'house')
      .where('house_id', 'in', [...new Set(seen.map((loan) => loan.borrower_house_id))])
      .orderBy('id')
      .forUpdate()
      .execute();
    // Relus sous verrou : un remboursement validé entre-temps a pu en solder.
    const loans = await dueLoans(context)
      .orderBy('borrower_house_id')
      .orderBy('id')
      .forUpdate()
      .execute();
    const system = new Map(
      (
        await trx
          .selectFrom('game.accounts')
          .select(['system_key', 'id'])
          .where('world_id', '=', worldId)
          .where('system_key', 'in', ['sink_temple_interest', 'faucet_temple_loans'])
          .execute()
      ).map((account) => [account.system_key, account.id]),
    );
    for (const key of ['sink_temple_interest', 'faucet_temple_loans'])
      if (!system.has(key)) throw new Error(`World ${worldId} has no ${key}`);
    const honor = config.honor;
    const loss = lossOf(context);
    for (const treasury of treasuries) {
      const houseId = treasury.house_id ?? '';
      const owed = loans.filter((loan) => loan.borrower_house_id === houseId);
      const taken = collectDueLoans(
        BigInt(treasury.balance),
        owed.map((loan) => ({
          id: loan.id,
          outstanding: BigInt(loan.outstanding),
          interestDue: BigInt(loan.interest) - BigInt(loan.interest_repaid),
        })),
      );
      for (const [index, collection] of taken.entries()) {
        const loan = owed[index];
        if (!loan) continue;
        at?.(`loan ${loan.id}`);
        const [interest, principal] = [Number(collection.interest), Number(collection.principal)];
        if (interest + principal > 0) {
          const entry = await trx
            .insertInto('game.ledger_entries')
            .values({
              world_id: worldId,
              kind: 'loan.collect',
              meta: JSON.stringify({ loanId: loan.id, houseId, gameDay }),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          const line = (account: string, amount: number) => ({
            entry_id: entry.id,
            account_id: account,
            amount,
          });
          const lines = [
            line(treasury.id, -(interest + principal)),
            line(system.get('sink_temple_interest') ?? '', interest),
            line(system.get('faucet_temple_loans') ?? '', principal),
          ];
          await trx
            .insertInto('game.ledger_lines')
            .values(lines.filter((row) => row.amount !== 0))
            .execute();
          await trx
            .insertInto('game.loan_repayments')
            .values({
              world_id: worldId,
              loan_id: loan.id,
              house_id: houseId,
              interest,
              principal,
              game_day: gameDay,
              ledger_entry_id: entry.id,
              kind: 'collect',
            })
            .execute();
          const outstanding = Number(collection.outstanding);
          await record(
            trx,
            loanCollectedSchema.parse({
              type: 'LoanCollected',
              payload: {
                loanId: loan.id,
                houseId,
                interest,
                principal,
                outstanding,
                // Ce qui reste dû après l'échéance : en défaut, celui d'un prêt en cours aussi, juste après.
                status: outstanding === 0 ? 'repaid' : 'defaulted',
                gameDay,
              },
            }),
          );
          summary.collected += 1;
          summary.collectedOboles += interest + principal;
        }
        if (loan.status !== 'active' || collection.outstanding === 0n) continue;
        await trx
          .updateTable('game.loans')
          .set({ status: 'defaulted', defaulted_day: gameDay })
          .where('id', '=', loan.id)
          .execute();
        const written =
          honor !== undefined && loss > 0
            ? await recordHonorChange(
                trx,
                { worldId, houseId, reason: 'loan_defaulted', reference: loan.id, gameDay },
                (balance) =>
                  honorChange(balance, 'loan_defaulted', {
                    min: honor.min,
                    max: honor.max,
                    changes: { loan_defaulted: -loss },
                  }),
              )
            : null;
        const honorLost = -(written?.amount ?? 0);
        await record(
          trx,
          loanDefaultedSchema.parse({
            type: 'LoanDefaulted',
            payload: {
              loanId: loan.id,
              houseId,
              lender: 'temple',
              outstanding: Number(collection.outstanding),
              honorLost,
              gameDay,
            },
          }),
        );
        summary.defaulted += 1;
        summary.honorLost += honorLost;
      }
    }
    return summary;
  },
};

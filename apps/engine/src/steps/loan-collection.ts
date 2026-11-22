import { DEFAULT_LOAN_DEFAULT_HONOR_LOSS } from '@oikos/config';
import {
  collateralSeizedSchema,
  loanCollectedSchema,
  loanDefaultedSchema,
  type DomainEvent,
  type LoanCollateral,
} from '@oikos/contracts';
import { lockBankVault, recordHonorChange, type Db } from '@oikos/db';
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
/**
 * Prêts d'un monde, du temple et des banques (#728), échus à l'instant de la clôture et encore dus, en cours (`active`)
 * ou en défaut.
 */
const dueLoans = ({ trx, worldId, closeAt }: CloseContext) =>
  trx
    .selectFrom('game.loans')
    .select([
      'id',
      'borrower_house_id',
      'interest',
      'interest_repaid',
      'outstanding',
      'status',
      'lender',
      'bank_id',
      'offer_id',
    ])
    .where('world_id', '=', worldId)
    .where('status', 'in', ['active', 'defaulted'])
    .where('due_at', '<=', closeAt);

/** Garantie de l'offre d'un prêt de banque, telle que l'événement la nomme. */
async function collateralOf({ trx }: CloseContext, offerId: string): Promise<LoanCollateral> {
  const offer = await trx
    .selectFrom('game.bank_loan_offers')
    .select([
      'collateral_kind',
      'collateral_city_id',
      'collateral_good_id',
      'collateral_quantity',
      'collateral_property_id',
    ])
    .where('id', '=', offerId)
    .executeTakeFirstOrThrow();
  return offer.collateral_kind === 'stock'
    ? {
        kind: 'stock',
        cityId: offer.collateral_city_id ?? '',
        goodId: offer.collateral_good_id ?? '',
        quantity: Number(offer.collateral_quantity),
      }
    : { kind: 'property', propertyId: offer.collateral_property_id ?? '' };
}

/**
 * Verrous du défaut des prêts (5.4, #725), première des deux étapes de l'échéance : la Timè (`honor:<maison>`) de chaque
 * maison dont un prêt, du temple ou d'une banque (#729), encore en cours, est échu à l'instant de la clôture, dans l'ordre
 * des identifiants. Elle
 * vient avec la dérobade aux liturgies, avant le déclin de la Charis et l'agora : `loan.borrowFromTemple` et
 * `liturgy.perform` prennent la Timè avant l'agora, et `loanCollection`, qui écrit la Timè perdue, vient bien après.
 * Sans perte de Timè, elle ne verrouille rien.
 */
export const loanDefaultLocks: CloseStep = {
  name: 'loanDefaultLocks',
  async run(context) {
    if (lossOf(context) === 0) return { houses: 0 };
    const houses = [
      ...new Set(
        (await dueLoans(context).where('status', '=', 'active').execute()).map(
          (l) => l.borrower_house_id,
        ),
      ),
    ].sort();
    for (const houseId of houses) await lockKey(context.trx, `honor:${houseId}`);
    return { houses: houses.length };
  },
};

/**
 * Échéance des prêts du temple (5.4, #725), après le prélèvement d'office des liturgies et avant l'entretien : chaque
 * prêt échu à l'instant de la clôture et encore dû prend sur la trésorerie de son emprunteur, hors séquestre, ce qu'elle
 * couvre, intérêts d'abord (`collectDueLoans`), par une écriture `loan.collect` (aucune s'il n'y a rien à prendre) ; ce
 * qui reste dû reste dû, sans intérêt de plus, et se prélève aux clôtures suivantes. Un prêt en cours qui reste dû passe
 * en défaut : événement `LoanDefaulted`, perte de Timè `templeTreasury.defaultHonorLoss` (motif `loan_defaulted`,
 * rognée aux bornes de la Timè), marque de déshonneur. Verrous : l'agora, les puits de l'entretien, les trésoreries par
 * identifiant, puis les prêts ; la base n'admet qu'un prélèvement par prêt et par jour, dans la transaction qui
 * enregistre la clôture de son jour : rejouée, la clôture ne prélève rien deux fois. La Timè perdue s'écrit sous les
 * verrous que `loanDefaultLocks` a pris avant l'agora. Un prêt de banque (#728) se prélève de même, dans l'ordre des
 * prêts de la maison, tout entier au coffre de sa banque (écriture `bank.loan_collect`, coffres verrouillés après les
 * prêts), et son solde libère sa garantie. S'il reste dû, la clôture saisit sa garantie (#729, `game.loan_seizures`) :
 * la base le fait passer en défaut et le solde, son reste dû remis, et remet le stock gagé, par le journal des stocks, ou
 * le logement, avec son bail en cours, à la maison de la banque ; la Timè se perd comme pour le temple, et les événements
 * `LoanDefaulted` puis `CollateralSeized` le disent. La saisie ne prend jamais rien de la trésorerie ni des sites.
 */
export const loanCollection: CloseStep = {
  name: 'loanCollection',
  async run(context) {
    const { trx, worldId, gameDay, config, at } = context;
    const summary = { collected: 0, collectedOboles: 0, defaulted: 0, honorLost: 0, seized: 0 };
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
    // Coffres des banques prêteuses, après les prêts, par identifiant de banque : un prélèvement leur revient tout entier.
    const vaults = new Map<string, string>();
    for (const bankId of [...new Set(loans.flatMap((loan) => loan.bank_id ?? []))].sort()) {
      const vault = await lockBankVault(trx, bankId);
      if (!vault) throw new Error(`Bank ${bankId} has no vault`);
      vaults.set(bankId, vault.accountId);
    }
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
          const vault = loan.bank_id ? vaults.get(loan.bank_id) : undefined;
          const entry = await trx
            .insertInto('game.ledger_entries')
            .values({
              world_id: worldId,
              kind: vault ? 'bank.loan_collect' : 'loan.collect',
              meta: JSON.stringify({
                loanId: loan.id,
                houseId,
                gameDay,
                ...(loan.bank_id && { bankId: loan.bank_id }),
              }),
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
            ...(vault
              ? [line(vault, interest + principal)]
              : [
                  line(system.get('sink_temple_interest') ?? '', interest),
                  line(system.get('faucet_temple_loans') ?? '', principal),
                ]),
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
                // Ce qui reste dû après l'échéance passe en défaut juste après, celui d'un prêt de banque par sa saisie.
                status: outstanding === 0 ? 'repaid' : 'defaulted',
                gameDay,
              },
            }),
          );
          summary.collected += 1;
          summary.collectedOboles += interest + principal;
        }
        if (loan.status !== 'active' || collection.outstanding === 0n) continue;
        // Un prêt du temple passe en défaut ; un prêt de banque, par la saisie de sa garantie, qui le solde aussitôt.
        let bankHouseId: string | null = null;
        if (loan.lender === 'bank')
          ({ bank_house_id: bankHouseId } = await trx
            .insertInto('game.loan_seizures')
            .values({ world_id: worldId, loan_id: loan.id, game_day: gameDay })
            .returning('bank_house_id')
            .executeTakeFirstOrThrow());
        else
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
              lender: loan.lender,
              outstanding: Number(collection.outstanding),
              honorLost,
              gameDay,
            },
          }),
        );
        summary.defaulted += 1;
        summary.honorLost += honorLost;
        if (bankHouseId === null) continue;
        await record(
          trx,
          collateralSeizedSchema.parse({
            type: 'CollateralSeized',
            payload: {
              loanId: loan.id,
              bankId: loan.bank_id,
              houseId,
              bankHouseId,
              collateral: await collateralOf(context, loan.offer_id ?? ''),
              writtenOff: Number(collection.outstanding),
              gameDay,
            },
          }),
        );
        summary.seized += 1;
      }
    }
    return summary;
  },
};

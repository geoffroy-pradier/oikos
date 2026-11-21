import {
  BANK_FOUND_ERROR_CODES,
  BANK_MOVE_CAPITAL_ERROR_CODES,
  bankFoundInputSchema,
  bankFoundOutputSchema,
  bankMoveCapitalInputSchema,
  bankMoveCapitalOutputSchema,
} from '@oikos/contracts';
import { lockBankVault, type Db } from '@oikos/db';
import { bankRequiredReserve, bankWithdrawableCapital } from '@oikos/sim';
import { defineCommand } from '../registry';
import { lock, lockHouse, refuse, systemAccount } from './loan-borrow';

const NO_FUNDS = { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' };
const EXISTS = { code: 'BANK_EXISTS', message: 'This house already has a bank.' };
const TAKEN = { code: 'NAME_TAKEN', message: 'A bank of this world already bears this name.' };
const CLOSED = { code: 'BANKS_CLOSED', message: 'No bank may be founded or run in this world.' };

/** La trésorerie de la maison, verrouillée après l'agora, comme `loan.repay`. */
const lockTreasury = (trx: Db, houseId: string) =>
  trx
    .selectFrom('game.accounts')
    .select(['id', 'balance'])
    .where('house_id', '=', houseId)
    .where('kind', '=', 'house')
    .forUpdate()
    .executeTakeFirstOrThrow();

/** Écriture de banque à deux lignes : `amount` oboles de `from` à `to`, qui nomme la banque. */
async function post(
  trx: Db,
  worldId: string,
  kind: 'bank.charter' | 'bank.capital_in' | 'bank.capital_out',
  bankId: string,
  from: string,
  to: string,
  amount: number,
) {
  const entry = await trx
    .insertInto('game.ledger_entries')
    .values({ world_id: worldId, kind, meta: JSON.stringify({ bankId }) })
    .returning('id')
    .executeTakeFirstOrThrow();
  // Le crédit d'abord : la base juge le découvert à chaque ligne insérée.
  await trx
    .insertInto('game.ledger_lines')
    .values([
      { entry_id: entry.id, account_id: to, amount },
      { entry_id: entry.id, account_id: from, amount: -amount },
    ])
    .execute();
}

/**
 * La maison fonde sa banque (docs/specs/05-economie.md, 5.4 ; #726), dans la cité de sa citoyenneté : elle paie le droit
 * de fondation que le joueur a vu, détruit par le puits `sink_bank_charter` (écriture `bank.charter`), et verse au
 * coffre, que la base ouvre à la fondation, un capital d'au moins le capital minimal (écriture `bank.capital_in`) ; les
 * deux en charges hors exploitation (4.1). Les taux affichés sont les bornes basses du monde. Refusée sans section
 * `banks`, à un autre droit, sous le capital minimal, au-delà de la trésorerie, pour une maison qui a déjà sa banque ou
 * un nom déjà pris.
 */
export const bankFound = defineCommand({
  name: 'bank.found',
  input: bankFoundInputSchema,
  output: bankFoundOutputSchema,
  errors: BANK_FOUND_ERROR_CODES,
  // La base fait foi sous concurrence : une banque par maison, un nom par monde, ni découvert.
  errorByConstraint: {
    banks_one_per_house: EXISTS,
    banks_name_unique: TAKEN,
    accounts_no_overdraft: NO_FUNDS,
  },
  async handler({ trx, userId, emit, config }, input) {
    // Verrous : la maison, puis l'agora du monde, la trésorerie, et le coffre par les lignes de l'écriture.
    const house = await lockHouse(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const rules = config.banks;
    if (!rules) return refuse(CLOSED.code, CLOSED.message);
    if (input.expectedCharterFee !== rules.charterFeeOboles)
      return refuse('FEE_CHANGED', `The charter fee is ${rules.charterFeeOboles} oboles.`);
    if (input.capital < rules.minCapitalOboles)
      return refuse('CAPITAL_TOO_LOW', `A bank needs at least ${rules.minCapitalOboles} oboles.`);
    const existing = await trx
      .selectFrom('game.banks')
      .select('id')
      .where('house_id', '=', house.id)
      .executeTakeFirst();
    if (existing) return refuse(EXISTS.code, EXISTS.message);
    const home = await trx
      .selectFrom('game.citizenships')
      .select('city_id')
      .where('house_id', '=', house.id)
      .executeTakeFirstOrThrow();
    await lock(trx, `market:${house.world_id}`);
    const treasury = await lockTreasury(trx, house.id);
    if (BigInt(treasury.balance) < BigInt(rules.charterFeeOboles) + BigInt(input.capital))
      return refuse(NO_FUNDS.code, NO_FUNDS.message);
    const [depositRateBps, loanRateBps] = [rules.depositRateBps.min, rules.loanRateBps.min];
    const bank = await trx
      .insertInto('game.banks')
      .values({
        world_id: house.world_id,
        city_id: home.city_id,
        house_id: house.id,
        name: input.name,
        deposit_rate_bps: depositRateBps,
        loan_rate_bps: loanRateBps,
        charter_fee: rules.charterFeeOboles,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (rules.charterFeeOboles > 0) {
      const sink = await systemAccount(trx, house.world_id, 'sink_bank_charter');
      await post(
        trx,
        house.world_id,
        'bank.charter',
        bank.id,
        treasury.id,
        sink.id,
        rules.charterFeeOboles,
      );
    }
    if (input.capital > 0) {
      const vault = await lockBankVault(trx, bank.id);
      if (!vault) throw new Error(`Bank ${bank.id} has no vault`);
      await post(
        trx,
        house.world_id,
        'bank.capital_in',
        bank.id,
        treasury.id,
        vault.accountId,
        input.capital,
      );
    }
    const data = {
      bankId: bank.id,
      cityId: home.city_id,
      name: input.name,
      charterFee: rules.charterFeeOboles,
      capital: input.capital,
      depositRateBps,
      loanRateBps,
    };
    emit({ type: 'BankFounded', payload: { ...data, houseId: house.id } });
    return { ok: true, data };
  },
});

/**
 * La maison verse au coffre de sa banque (`in`, de sa trésorerie) ou en retire (`out`, vers sa trésorerie) du capital
 * (#726), en une écriture `bank.capital_in` ou `bank.capital_out`, hors exploitation (4.1). Un retrait ne prend que ce
 * qui excède la réserve exigée (`bankRequiredReserve`, le capital minimal tant qu'il n'y a pas de dépôt, #727), lue dans
 * la configuration en vigueur. Refusée sans section `banks`, sans banque ou au-delà de la trésorerie.
 */
export const bankMoveCapital = defineCommand({
  name: 'bank.moveCapital',
  input: bankMoveCapitalInputSchema,
  output: bankMoveCapitalOutputSchema,
  errors: BANK_MOVE_CAPITAL_ERROR_CODES,
  errorByConstraint: { accounts_no_overdraft: NO_FUNDS },
  async handler({ trx, userId, emit, config }, input) {
    // Verrous : la maison (ses mouvements de capital se suivent), l'agora, la trésorerie, puis le coffre.
    const house = await lockHouse(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const rules = config.banks;
    if (!rules) return refuse(CLOSED.code, CLOSED.message);
    const bank = await trx
      .selectFrom('game.banks')
      .select('id')
      .where('house_id', '=', house.id)
      .executeTakeFirst();
    if (!bank) return refuse('BANK_NOT_FOUND', 'This house has no bank.');
    await lock(trx, `market:${house.world_id}`);
    const treasury = await lockTreasury(trx, house.id);
    const vault = await lockBankVault(trx, bank.id);
    if (!vault) throw new Error(`Bank ${bank.id} has no vault`);
    // Aucun dépôt avant #727 : la réserve exigée est le capital minimal.
    const reserve = bankRequiredReserve(0n, rules);
    const amount = BigInt(input.amount);
    if (input.direction === 'in') {
      if (BigInt(treasury.balance) < amount) return refuse(NO_FUNDS.code, NO_FUNDS.message);
      await post(
        trx,
        house.world_id,
        'bank.capital_in',
        bank.id,
        treasury.id,
        vault.accountId,
        input.amount,
      );
    } else {
      const free = bankWithdrawableCapital(BigInt(vault.balance), reserve);
      if (amount > free)
        return refuse('RESERVE_SHORT', `At most ${free} oboles may leave the vault.`);
      await post(
        trx,
        house.world_id,
        'bank.capital_out',
        bank.id,
        vault.accountId,
        treasury.id,
        input.amount,
      );
    }
    const data = {
      bankId: bank.id,
      direction: input.direction,
      amount: input.amount,
      vault: vault.balance + (input.direction === 'in' ? input.amount : -input.amount),
      requiredReserve: Number(reserve),
    };
    emit({ type: 'BankCapitalMoved', payload: { ...data, houseId: house.id } });
    return { ok: true, data };
  },
});

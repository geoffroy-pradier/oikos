import {
  BANK_DEPOSIT_ERROR_CODES,
  BANK_FOUND_ERROR_CODES,
  BANK_MOVE_CAPITAL_ERROR_CODES,
  BANK_WITHDRAW_ERROR_CODES,
  bankDepositInputSchema,
  bankDepositOutputSchema,
  bankFoundInputSchema,
  bankFoundOutputSchema,
  bankMoveCapitalInputSchema,
  bankMoveCapitalOutputSchema,
  bankWithdrawInputSchema,
  bankWithdrawOutputSchema,
} from '@oikos/contracts';
import { lockBankVault, type Db } from '@oikos/db';
import { sql } from 'kysely';
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

/** Écriture de banque à deux lignes : `amount` oboles de `from` à `to`, qui nomme la banque ; rend son identifiant. */
async function post(
  trx: Db,
  worldId: string,
  kind: 'bank.charter' | 'bank.capital_in' | 'bank.capital_out' | 'bank.deposit' | 'bank.withdraw',
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
  return entry.id;
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
 * qui excède la réserve exigée (`bankRequiredReserve`, sur les dépôts que la banque doit, #727), lue dans la
 * configuration en vigueur. Refusée sans section `banks`, sans banque ou au-delà de la trésorerie.
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
    // Réserve exigée des dépôts que la banque doit, qui ne bougent que sous le verrou de l'agora (#727).
    const owed = await trx
      .selectFrom('game.bank_deposits')
      .select(sql<string>`coalesce(sum(balance), 0)::text`.as('total'))
      .where('bank_id', '=', bank.id)
      .executeTakeFirstOrThrow();
    const reserve = bankRequiredReserve(BigInt(owed.total), rules);
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

const NO_BANK = { code: 'BANK_NOT_FOUND', message: 'No bank of this world bears this id.' };
const OWN = {
  code: 'OWN_BANK',
  message: 'A house pays capital into its own bank; it does not deposit there.',
};
const ABOVE = { code: 'ABOVE_BALANCE', message: 'The withdrawal exceeds the deposit.' };
const SHORT = {
  code: 'VAULT_SHORT',
  message: 'The vault of this bank cannot cover this withdrawal.',
};

/** Une banque du monde de la maison, avec son taux de dépôt affiché. */
const bankIn = (trx: Db, worldId: string, bankId: string) =>
  trx
    .selectFrom('game.banks')
    .select(['id', 'house_id', 'deposit_rate_bps'])
    .where('id', '=', bankId)
    .where('world_id', '=', worldId)
    .executeTakeFirst();

/** Le dépôt de la maison dans la banque, verrouillé après le coffre ; `undefined` sans dépôt. */
const lockDeposit = (trx: Db, bankId: string, houseId: string) =>
  trx
    .selectFrom('game.bank_deposits')
    .select(['id', 'balance'])
    .where('bank_id', '=', bankId)
    .where('house_id', '=', houseId)
    .forUpdate()
    .executeTakeFirst();

/** Dépôt ou retrait : l'écriture de banque, de `from` à `to`, puis le mouvement qu'elle paie, que la base applique. */
async function moveDeposit(trx: Db, move: DepositMove, from: string, to: string) {
  const entry = await post(
    trx,
    move.worldId,
    `bank.${move.kind}`,
    move.bankId,
    from,
    to,
    move.amount,
  );
  await trx
    .insertInto('game.bank_deposit_movements')
    .values({
      world_id: move.worldId,
      deposit_id: move.depositId,
      bank_id: move.bankId,
      house_id: move.houseId,
      kind: move.kind,
      amount: move.amount,
      ledger_entry_id: entry,
    })
    .execute();
}
interface DepositMove {
  worldId: string;
  bankId: string;
  depositId: string;
  houseId: string;
  kind: 'deposit' | 'withdraw';
  amount: number;
}

/**
 * La maison dépose dans une banque de son monde, qui n'est pas la sienne (#727), au taux de dépôt affiché que le joueur a
 * vu : la monnaie passe de sa trésorerie au coffre (écriture `bank.deposit`, hors exploitation, 4.1) ; sa créance, son
 * dépôt, ouvert au premier versement, grossit d'autant. Refusée sans section `banks`, pour une banque inconnue ou la
 * sienne, à un autre taux, ou au-delà de la trésorerie.
 */
export const bankDeposit = defineCommand({
  name: 'bank.deposit',
  input: bankDepositInputSchema,
  output: bankDepositOutputSchema,
  errors: BANK_DEPOSIT_ERROR_CODES,
  errorByConstraint: { accounts_no_overdraft: NO_FUNDS, bank_deposits_not_own_bank: OWN },
  async handler({ trx, userId, emit, config }, input) {
    // Verrous : la maison, l'agora (que `bank.setRates` et la clôture tiennent pour les taux et les intérêts), la
    // trésorerie, le coffre, puis le dépôt.
    const house = await lockHouse(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    if (!config.banks) return refuse(CLOSED.code, CLOSED.message);
    await lock(trx, `market:${house.world_id}`);
    const bank = await bankIn(trx, house.world_id, input.bankId);
    if (!bank) return refuse(NO_BANK.code, NO_BANK.message);
    if (bank.house_id === house.id) return refuse(OWN.code, OWN.message);
    if (bank.deposit_rate_bps !== input.expectedRateBps)
      return refuse('RATE_CHANGED', `The deposit rate is ${bank.deposit_rate_bps} basis points.`);
    const treasury = await lockTreasury(trx, house.id);
    if (BigInt(treasury.balance) < BigInt(input.amount))
      return refuse(NO_FUNDS.code, NO_FUNDS.message);
    const vault = await lockBankVault(trx, bank.id);
    if (!vault) throw new Error(`Bank ${bank.id} has no vault`);
    await trx
      .insertInto('game.bank_deposits')
      .values({ world_id: house.world_id, bank_id: bank.id, house_id: house.id })
      .onConflict((conflict) => conflict.columns(['bank_id', 'house_id']).doNothing())
      .execute();
    const deposit = await lockDeposit(trx, bank.id, house.id);
    if (!deposit) throw new Error(`House ${house.id} has no deposit in bank ${bank.id}`);
    const move = {
      worldId: house.world_id,
      bankId: bank.id,
      depositId: deposit.id,
      houseId: house.id,
    };
    await moveDeposit(
      trx,
      { ...move, kind: 'deposit', amount: input.amount },
      treasury.id,
      vault.accountId,
    );
    const data = {
      bankId: bank.id,
      depositId: deposit.id,
      amount: input.amount,
      balance: Number(deposit.balance) + input.amount,
      rateBps: bank.deposit_rate_bps,
    };
    emit({ type: 'BankDeposited', payload: { ...data, houseId: house.id } });
    return { ok: true, data };
  },
});

/**
 * La maison retire de son dépôt dans une banque (#727) : la monnaie revient du coffre à sa trésorerie (écriture
 * `bank.withdraw`, hors exploitation, 4.1). La réserve exigée ne borne jamais un retrait de déposant : seuls le solde du
 * dépôt et le coffre le bornent, et un retrait que le coffre ne couvre pas est refusé (`VAULT_SHORT`), ce qui rend la
 * ruée possible (5.4). Admis sans section `banks` : un déposant reprend toujours ce que le coffre couvre.
 */
export const bankWithdraw = defineCommand({
  name: 'bank.withdraw',
  input: bankWithdrawInputSchema,
  output: bankWithdrawOutputSchema,
  errors: BANK_WITHDRAW_ERROR_CODES,
  errorByConstraint: { accounts_no_overdraft: SHORT, bank_deposits_balance_bounds: ABOVE },
  async handler({ trx, userId, emit }, input) {
    // Verrous : ceux de `bank.deposit`, dans le même ordre.
    const house = await lockHouse(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    await lock(trx, `market:${house.world_id}`);
    const bank = await bankIn(trx, house.world_id, input.bankId);
    if (!bank) return refuse(NO_BANK.code, NO_BANK.message);
    const treasury = await lockTreasury(trx, house.id);
    const vault = await lockBankVault(trx, bank.id);
    if (!vault) throw new Error(`Bank ${bank.id} has no vault`);
    const deposit = await lockDeposit(trx, bank.id, house.id);
    if (!deposit) return refuse('DEPOSIT_NOT_FOUND', 'This house has no deposit in this bank.');
    const amount = BigInt(input.amount);
    if (amount > BigInt(deposit.balance))
      return refuse(ABOVE.code, `The deposit holds ${deposit.balance} oboles.`);
    if (amount > BigInt(vault.balance)) return refuse(SHORT.code, SHORT.message);
    const move = {
      worldId: house.world_id,
      bankId: bank.id,
      depositId: deposit.id,
      houseId: house.id,
    };
    await moveDeposit(
      trx,
      { ...move, kind: 'withdraw', amount: input.amount },
      vault.accountId,
      treasury.id,
    );
    const data = {
      bankId: bank.id,
      depositId: deposit.id,
      amount: input.amount,
      balance: Number(deposit.balance) - input.amount,
    };
    emit({ type: 'BankWithdrawn', payload: { ...data, houseId: house.id } });
    return { ok: true, data };
  },
});

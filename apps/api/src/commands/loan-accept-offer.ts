import {
  LOAN_ACCEPT_OFFER_ERROR_CODES,
  type LoanCollateral,
  loanAcceptOfferInputSchema,
  loanAcceptOfferOutputSchema,
} from '@oikos/contracts';
import { DEFAULT_DISHONOR_DAYS } from '@oikos/config';
import { lockBankVault, type Db } from '@oikos/db';
import {
  bankLendable,
  bankRequiredReserve,
  dailyCloseAt,
  gameDayAt,
  loanInterest,
} from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand } from '../registry';
import { dishonorMessage, houseDishonor, lock, lockHouse, refuse } from './loan-borrow';

const CLOSED = { code: 'OFFER_CLOSED', message: 'This offer is no longer open.' };
const NOT_FREE = { code: 'COLLATERAL_NOT_FREE', message: 'This collateral is not free to pledge.' };
const SHORT = { code: 'RESERVE_SHORT', message: 'This bank may not lend so much.' };

/**
 * La garantie est libre : un stock libre de la maison dans sa cité (hors réservations des ventes en attente et des autres
 * gages) qui la couvre, ou un logement de la maison sans offre ouverte ni autre prêt qui le gage. La base le revérifie
 * (`pledge_bank_loan_collateral`) et fait foi sous concurrence.
 */
async function collateralFree(trx: Db, houseId: string, collateral: LoanCollateral) {
  if (collateral.kind === 'stock') {
    const stock = await trx
      .selectFrom('game.inventories')
      .select(['quantity', 'reserved'])
      .where('house_id', '=', houseId)
      .where('city_id', '=', collateral.cityId)
      .where('good_id', '=', collateral.goodId)
      .executeTakeFirst();
    return Boolean(stock && Number(stock.quantity) - Number(stock.reserved) >= collateral.quantity);
  }
  const free = await sql<{ free: boolean }>`
    select p.owner_house_id = ${houseId}::uuid
       and not exists (select 1 from game.property_listings l where l.property_id = p.id and l.closed_at is null)
       and not exists (select 1 from game.loans o join game.bank_loan_offers f on f.id = o.offer_id
                       where f.collateral_property_id = p.id and o.status <> 'repaid') as free
    from game.properties p where p.id = ${collateral.propertyId}::uuid`.execute(trx);
  return free.rows[0]?.free === true;
}

/**
 * La maison accepte l'offre d'une banque (docs/specs/05-economie.md, 5.4 ; #728), aux conditions qu'elle a vues : le
 * principal passe du coffre à sa trésorerie (écriture `bank.loan_disburse`, nature 4.1 `loans`), l'intérêt simple est
 * fixé pour toute la durée (`loanInterest`), l'échéance est la clôture `termDays` jours après, et la garantie est
 * bloquée jusqu'au solde, dans une transaction, une fois. Refusée pour une offre inconnue ou fermée, à d'autres
 * conditions (`TERMS_CHANGED`), sans section `banks`, sous une marque de déshonneur, si le coffre moins le principal
 * passerait sous la réserve exigée de la configuration en vigueur (`RESERVE_SHORT`), ou si la garantie n'est plus libre.
 */
export const loanAcceptOffer = defineCommand({
  name: 'loan.acceptOffer',
  input: loanAcceptOfferInputSchema,
  output: loanAcceptOfferOutputSchema,
  errors: LOAN_ACCEPT_OFFER_ERROR_CODES,
  // La base fait foi sous concurrence : une offre ouverte, un prêt par offre, une garantie libre, un coffre jamais débiteur.
  errorByConstraint: {
    loans_offer_open: CLOSED,
    loans_offer_once: CLOSED,
    loans_collateral_free: NOT_FREE,
    inventories_reserved_within_quantity: NOT_FREE,
    accounts_no_overdraft: SHORT,
  },
  async handler({ trx, userId, emit, configAt, now }, input) {
    // Règles et horloge de la version en vigueur à l'instant de la base, qui date le prêt comme la base le vérifie.
    const config = await configAt(now);
    // Verrous : la maison, sa Timè, puis l'agora (que `bank.withdrawOffer`, les dépôts et la clôture tiennent),
    // l'offre, la trésorerie et le coffre ; la garantie par la base.
    const house = await lockHouse(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    await lock(trx, `honor:${house.id}`);
    await lock(trx, `market:${house.world_id}`);
    const offer = await trx
      .selectFrom('game.bank_loan_offers')
      .selectAll()
      .where('id', '=', input.offerId)
      .where('borrower_house_id', '=', house.id)
      .forUpdate()
      .executeTakeFirst();
    if (!offer) return refuse('OFFER_NOT_FOUND', 'This house has received no such offer.');
    if (offer.status !== 'open') return refuse(CLOSED.code, CLOSED.message);
    const seen = input.collateral;
    const same =
      Number(offer.principal) === input.principal &&
      offer.rate_bps === input.rateBps &&
      offer.term_days === input.termDays &&
      offer.collateral_kind === seen.kind &&
      (seen.kind === 'stock'
        ? offer.collateral_city_id === seen.cityId &&
          offer.collateral_good_id === seen.goodId &&
          Number(offer.collateral_quantity) === seen.quantity
        : offer.collateral_property_id === seen.propertyId);
    if (!same) return refuse('TERMS_CHANGED', 'The terms of this offer are not those you saw.');
    const rules = config.banks;
    if (!rules) return refuse('BANKS_CLOSED', 'No bank may lend in this world.');
    const borrowedDay = gameDayAt(now, config.clock);
    const { mark } = await houseDishonor(
      trx,
      house.id,
      borrowedDay,
      config.templeTreasury?.dishonorDays ?? DEFAULT_DISHONOR_DAYS,
    );
    if (mark.dishonored) return refuse('DISHONORED', dishonorMessage(mark.untilDay));
    const treasury = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('house_id', '=', house.id)
      .where('kind', '=', 'house')
      .forUpdate()
      .executeTakeFirstOrThrow();
    const vault = await lockBankVault(trx, offer.bank_id);
    if (!vault) throw new Error(`Bank ${offer.bank_id} has no vault`);
    // Réserve exigée des dépôts que la banque doit, qui ne bougent que sous le verrou de l'agora (#727).
    const owed = await trx
      .selectFrom('game.bank_deposits')
      .select(sql<string>`coalesce(sum(balance), 0)::text`.as('total'))
      .where('bank_id', '=', offer.bank_id)
      .executeTakeFirstOrThrow();
    const lendable = bankLendable(
      BigInt(vault.balance),
      bankRequiredReserve(BigInt(owed.total), rules),
    );
    if (BigInt(input.principal) > lendable)
      return refuse(SHORT.code, `This bank may lend at most ${lendable} oboles.`);
    if (!(await collateralFree(trx, house.id, input.collateral)))
      return refuse(NOT_FREE.code, NOT_FREE.message);

    const interest = loanInterest(BigInt(input.principal), input.rateBps, input.termDays);
    const dueDay = borrowedDay + input.termDays;
    const dueAt = dailyCloseAt(dueDay, config.clock);
    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({
        world_id: house.world_id,
        kind: 'bank.loan_disburse',
        meta: JSON.stringify({ bankId: offer.bank_id, houseId: house.id, offerId: offer.id }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // Le crédit d'abord : la base juge le découvert à chaque ligne insérée.
    await trx
      .insertInto('game.ledger_lines')
      .values([
        { entry_id: entry.id, account_id: treasury.id, amount: input.principal },
        { entry_id: entry.id, account_id: vault.accountId, amount: -input.principal },
      ])
      .execute();
    const loan = await trx
      .insertInto('game.loans')
      .values({
        world_id: house.world_id,
        lender: 'bank',
        borrower_house_id: house.id,
        principal: input.principal,
        rate_bps: input.rateBps,
        term_days: input.termDays,
        interest: Number(interest),
        borrowed_day: borrowedDay,
        due_day: dueDay,
        due_at: dueAt,
        disbursement_entry_id: entry.id,
        bank_id: offer.bank_id,
        offer_id: offer.id,
      })
      .returning(['id', 'outstanding'])
      .executeTakeFirstOrThrow();

    const data = {
      loanId: loan.id,
      offerId: offer.id,
      bankId: offer.bank_id,
      principal: input.principal,
      rateBps: input.rateBps,
      termDays: input.termDays,
      interest: Number(interest),
      outstanding: Number(loan.outstanding),
      dueDay,
      dueAt: dueAt.toISOString(),
    };
    emit({
      type: 'LoanOfferAccepted',
      payload: { ...data, collateral: input.collateral, houseId: house.id },
    });
    return { ok: true, data };
  },
});

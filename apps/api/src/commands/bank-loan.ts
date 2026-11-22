import {
  BANK_OFFER_LOAN_ERROR_CODES,
  BANK_WITHDRAW_OFFER_ERROR_CODES,
  bankOfferLoanInputSchema,
  bankOfferLoanOutputSchema,
  bankWithdrawOfferInputSchema,
  bankWithdrawOfferOutputSchema,
  type LoanCollateral,
} from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { loanInterest } from '@oikos/sim';
import { defineCommand } from '../registry';
import { lock, lockHouse, refuse } from './loan-borrow';

/** La banque de la maison, s'il y en a une. */
const bankOf = (trx: Db, houseId: string) =>
  trx.selectFrom('game.banks').select('id').where('house_id', '=', houseId).executeTakeFirst();

/** La garantie nomme une cité, un bien de la configuration ou un logement de ce monde. */
async function collateralKnown(
  trx: Db,
  worldId: string,
  collateral: LoanCollateral,
  goods: readonly { id: string }[],
) {
  if (collateral.kind === 'property')
    return Boolean(
      await trx
        .selectFrom('game.properties')
        .select('id')
        .where('id', '=', collateral.propertyId)
        .where('world_id', '=', worldId)
        .executeTakeFirst(),
    );
  if (!goods.some((good) => good.id === collateral.goodId)) return false;
  return Boolean(
    await trx
      .selectFrom('game.cities')
      .select('id')
      .where('id', '=', collateral.cityId)
      .where('world_id', '=', worldId)
      .executeTakeFirst(),
  );
}

/**
 * La banque de la maison offre un prêt gagé à une maison de joueur de son monde (docs/specs/05-economie.md, 5.4 ; #728) :
 * principal, taux libre dans les bornes du monde (`bank_rules`), durée et garantie, un stock ou un logement de
 * l'emprunteur. Rien ne bouge encore : ni monnaie, ni garantie, que l'acceptation juge (`loan.acceptOffer`) ; l'offre
 * ne dit rien au banquier du stock ni des biens de l'emprunteur. Refusée sans section `banks`, sans banque, pour une
 * maison inconnue, PNJ ou la sienne, hors des bornes du taux, ou pour une garantie qui n'existe pas dans ce monde.
 */
export const bankOfferLoan = defineCommand({
  name: 'bank.offerLoan',
  input: bankOfferLoanInputSchema,
  output: bankOfferLoanOutputSchema,
  errors: BANK_OFFER_LOAN_ERROR_CODES,
  async handler({ trx, userId, emit, config }, input) {
    const house = await lockHouse(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const rules = config.banks;
    if (!rules) return refuse('BANKS_CLOSED', 'No bank may lend in this world.');
    const bank = await bankOf(trx, house.id);
    if (!bank) return refuse('BANK_NOT_FOUND', 'This house has no bank.');
    if (input.borrowerHouseId === house.id)
      return refuse('OWN_HOUSE', 'A bank does not lend to its own house.');
    const borrower = await trx
      .selectFrom('game.houses')
      .select('id')
      .where('id', '=', input.borrowerHouseId)
      .where('world_id', '=', house.world_id)
      .where('kind', '=', 'player')
      .executeTakeFirst();
    if (!borrower)
      return refuse('BORROWER_NOT_FOUND', 'No player house of this world bears this id.');
    const bounds = rules.loanRateBps;
    if (input.rateBps < bounds.min || input.rateBps > bounds.max)
      return refuse(
        'RATE_OUT_OF_BOUNDS',
        `Loan rates run from ${bounds.min} to ${bounds.max} basis points.`,
      );
    if (!(await collateralKnown(trx, house.world_id, input.collateral, config.goods)))
      return refuse('COLLATERAL_NOT_FOUND', 'This world has no such collateral.');
    const { collateral } = input;
    const offer = await trx
      .insertInto('game.bank_loan_offers')
      .values({
        world_id: house.world_id,
        bank_id: bank.id,
        borrower_house_id: borrower.id,
        principal: input.principal,
        rate_bps: input.rateBps,
        term_days: input.termDays,
        collateral_kind: collateral.kind,
        ...(collateral.kind === 'stock'
          ? {
              collateral_city_id: collateral.cityId,
              collateral_good_id: collateral.goodId,
              collateral_quantity: collateral.quantity,
            }
          : { collateral_property_id: collateral.propertyId }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const interest = loanInterest(BigInt(input.principal), input.rateBps, input.termDays);
    const data = { offerId: offer.id, bankId: bank.id, ...input, interest: Number(interest) };
    emit({ type: 'LoanOffered', payload: { ...data, houseId: house.id } });
    return { ok: true, data };
  },
});

/**
 * La banque de la maison retire une offre de prêt encore ouverte (#728). Sous le verrou de l'agora, que l'acceptation
 * tient aussi : une offre retirée pendant qu'on l'accepte n'est pas acceptée, ou l'inverse, jamais les deux.
 */
export const bankWithdrawOffer = defineCommand({
  name: 'bank.withdrawOffer',
  input: bankWithdrawOfferInputSchema,
  output: bankWithdrawOfferOutputSchema,
  errors: BANK_WITHDRAW_OFFER_ERROR_CODES,
  async handler({ trx, userId, emit }, input) {
    const house = await lockHouse(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const bank = await bankOf(trx, house.id);
    const unknown = refuse('OFFER_NOT_FOUND', 'This bank has made no such offer.');
    if (!bank) return unknown;
    await lock(trx, `market:${house.world_id}`);
    const offer = await trx
      .selectFrom('game.bank_loan_offers')
      .select(['id', 'status'])
      .where('id', '=', input.offerId)
      .where('bank_id', '=', bank.id)
      .forUpdate()
      .executeTakeFirst();
    if (!offer) return unknown;
    if (offer.status !== 'open') return refuse('OFFER_CLOSED', 'This offer is already closed.');
    await trx
      .updateTable('game.bank_loan_offers')
      .set({ status: 'withdrawn' })
      .where('id', '=', offer.id)
      .execute();
    const data = { offerId: offer.id, bankId: bank.id };
    emit({ type: 'LoanOfferWithdrawn', payload: { ...data, houseId: house.id } });
    return { ok: true, data };
  },
});

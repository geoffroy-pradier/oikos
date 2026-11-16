import {
  TEMPLE_MAKE_OFFERING_ERROR_CODES,
  templeMakeOfferingInputSchema,
  templeMakeOfferingOutputSchema,
} from '@oikos/contracts';
import { offeringCharis } from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});
const NO_FUNDS = { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' };
const NO_STOCK = {
  code: 'INSUFFICIENT_STOCK',
  message: 'Not enough free stock for this offering.',
};
const LIMIT = { code: 'CHARIS_LIMIT_REACHED', message: 'This Charis cannot grow any further.' };
const byGood = (a: { goodId: string }, b: { goodId: string }) => (a.goodId < b.goodId ? -1 : 1);

/**
 * La maison fait une offrande à un dieu (docs/specs/07-dieux-faveur-evenements.md, 7.1) : ses oboles sont
 * détruites (puits `sink_offerings`, écriture `temple.offering`, nature 4.1 `offerings`), ses biens sortent de
 * son stock libre dans sa cité vers l'extrémité `offering` du journal des stocks, et la Charis de l'offrande,
 * au taux du dieu en vigueur (`offeringCharis`), entre au journal de la Charis : le tout dans une transaction.
 * Une Charis autre que celle vue est refusée. Seule la maison qui offre gagne de la Charis.
 */
export const templeMakeOffering = defineCommand({
  name: 'temple.makeOffering',
  input: templeMakeOfferingInputSchema,
  output: templeMakeOfferingOutputSchema,
  errors: TEMPLE_MAKE_OFFERING_ERROR_CODES,
  // La base fait foi sous concurrence : ni découvert, ni stock réservé offert, ni Charis hors bornes.
  errorByConstraint: {
    accounts_no_overdraft: NO_FUNDS,
    inventories_reserved_within_quantity: NO_STOCK,
    inventories_quantity_check: NO_STOCK,
    favor_charis_range: LIMIT,
  },
  async handler({ trx, userId, emit, config }, input) {
    // Ordre des verrous : la maison, puis sa Charis envers ce dieu, AVANT l'agora. Le déclin de la clôture
    // verrouille les Charis sans l'agora, puis la prend aux étapes suivantes : prise après l'agora, la Charis
    // ferait attendre l'une l'autre la commande et la clôture (interblocage). La maison, verrouillée comme
    // par `site.acquire` (`FOR NO KEY UPDATE`), fait se suivre les offrandes d'une même maison : une Charis
    // encore inexistante, sans ligne à verrouiller, ne peut pas naître d'une autre offrande entre-temps.
    // Puis l'agora du monde, la trésorerie et les stocks dans l'ordre des biens, comme `property.renovate`.
    const house = await trx
      .selectFrom('game.houses')
      .select(['id', 'world_id'])
      .where('user_id', '=', userId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const god = config.gods.find((candidate) => candidate.id === input.godId);
    if (!god) return refuse('GOD_NOT_FOUND', 'Unknown god.');
    const goods = [...input.goods].sort(byGood);
    const gain = offeringCharis(god, { oboles: input.oboles, goods });
    if (!gain.ok) return refuse('OFFERING_REFUSED', 'This god does not accept this offering.');
    if (gain.charis !== input.expectedCharis)
      return refuse('CHARIS_CHANGED', `This offering now brings ${gain.charis} Charis.`);

    const { city_id: cityId } = await trx
      .selectFrom('game.citizenships')
      .select('city_id')
      .where('house_id', '=', house.id)
      .executeTakeFirstOrThrow();
    await trx
      .selectFrom('game.favor')
      .select('charis')
      .where('house_id', '=', house.id)
      .where('god_id', '=', god.id)
      .forUpdate()
      .execute();
    const agora = `market:${house.world_id}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${agora}, 0))`.execute(trx);
    let treasuryId: string | null = null;
    if (input.oboles > 0) {
      const account = await trx
        .selectFrom('game.accounts')
        .select(['id', 'balance'])
        .where('house_id', '=', house.id)
        .where('kind', '=', 'house')
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (Number(account.balance) < input.oboles) return refuse(NO_FUNDS.code, NO_FUNDS.message);
      treasuryId = account.id;
    }
    // Stocks libres de la cité de la maison, verrouillés dans l'ordre des biens (classement "C") : ce que
    // réservent les ventes en attente n'est pas offert.
    const goodIds = goods.map((entry) => entry.goodId);
    const stocks =
      goodIds.length === 0
        ? []
        : await trx
            .selectFrom('game.inventories')
            .select(['id', 'good_id', 'quantity', 'reserved'])
            .where('house_id', '=', house.id)
            .where('city_id', '=', cityId)
            .where('good_id', 'in', goodIds)
            .orderBy(sql`good_id collate "C"`)
            .forUpdate()
            .execute();
    const stockOf = (goodId: string) => stocks.find((stock) => stock.good_id === goodId);
    for (const { goodId, quantity } of goods) {
      const stock = stockOf(goodId);
      if (!stock || Number(stock.quantity) - Number(stock.reserved) < quantity)
        return refuse(NO_STOCK.code, NO_STOCK.message);
    }

    let entryId: string | null = null;
    if (treasuryId !== null) {
      const sink = await trx
        .selectFrom('game.accounts')
        .select('id')
        .where('world_id', '=', house.world_id)
        .where('system_key', '=', 'sink_offerings')
        .executeTakeFirstOrThrow(() => new Error(`World ${house.world_id} has no sink_offerings`));
      const entry = await trx
        .insertInto('game.ledger_entries')
        .values({
          world_id: house.world_id,
          kind: 'temple.offering',
          meta: JSON.stringify({ houseId: house.id, godId: god.id }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      entryId = entry.id;
      await trx
        .insertInto('game.ledger_lines')
        .values([
          { entry_id: entry.id, account_id: treasuryId, amount: -input.oboles },
          { entry_id: entry.id, account_id: sink.id, amount: input.oboles },
        ])
        .execute();
    }
    const offering = await trx
      .insertInto('game.offerings')
      .values({
        world_id: house.world_id,
        house_id: house.id,
        city_id: cityId,
        god_id: god.id,
        oboles: input.oboles,
        charis: gain.charis,
        ledger_entry_id: entryId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (goods.length > 0)
      await trx
        .insertInto('game.stock_ledger')
        .values(
          goods.map(({ goodId, quantity }) => ({
            world_id: house.world_id,
            good_id: goodId,
            quantity,
            from_inventory_id: stockOf(goodId)?.id ?? null,
            to_system: 'offering',
            kind: 'temple.offering',
            offering_id: offering.id,
          })),
        )
        .execute();
    await trx
      .insertInto('game.favor_ledger')
      .values({
        world_id: house.world_id,
        house_id: house.id,
        god_id: god.id,
        amount: gain.charis,
        kind: 'offering',
        offering_id: offering.id,
      })
      .execute();

    const after = await trx
      .selectFrom('game.favor')
      .select('charis')
      .where('house_id', '=', house.id)
      .where('god_id', '=', god.id)
      .executeTakeFirstOrThrow();

    emit({
      type: 'OfferingMade',
      payload: {
        offeringId: offering.id,
        houseId: house.id,
        cityId: cityId,
        godId: god.id,
        oboles: input.oboles,
        goods,
        charisGained: gain.charis,
      },
    });
    return {
      ok: true,
      data: {
        offeringId: offering.id,
        godId: god.id,
        oboles: input.oboles,
        goods,
        charisGained: gain.charis,
        charis: Number(after.charis),
      },
    };
  },
});

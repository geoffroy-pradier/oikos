import {
  ADMIN_BUY_BACK_GOOD_ERROR_CODES,
  adminBuyBackGoodInputSchema,
  adminBuyBackGoodOutputSchema,
  BUYBACK_ROLES,
} from '@oikos/contracts';
import { planBuyback, sameBuybackTotals, type SystemAccountKey } from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand } from '../registry';

/** Robinet du rachat (5.5) et extrémité du journal des stocks dont rien ne ressort (migration 43). */
const FAUCET: SystemAccountKey = 'faucet_good_buyback';
const RETIRED = 'good_buyback';
const KIND = 'admin.good_buyback';

/**
 * Rachète tout le stock d'un bien que la configuration en vigueur connaît encore, pour qu'une version qui
 * le retire puisse être programmée (docs/specs/05-economie.md, 5.1 ; #229). En une transaction, tous mondes
 * confondus : les ordres ouverts du bien sont annulés comme par `market.cancelOrder` (séquestre rendu,
 * réservation levée), puis chaque maison est payée de son stock au prix de référence, depuis le robinet
 * de son monde, et ce stock passe à l'extrémité système `good_buyback`. Rien n'est fait si l'état n'est
 * plus celui qu'Olympe a montré (`BUYBACK_CHANGED`).
 */
export const adminBuyBackGood = defineCommand({
  name: 'admin.buyBackGood',
  admin: BUYBACK_ROLES,
  input: adminBuyBackGoodInputSchema,
  output: adminBuyBackGoodOutputSchema,
  errors: ADMIN_BUY_BACK_GOOD_ERROR_CODES,
  async handler({ trx, userId, emit, config }, { goodId, expected }) {
    const good = config.goods.find((candidate) => candidate.id === goodId);
    if (!good) return { ok: false, error: { code: 'GOOD_NOT_FOUND', message: 'Unknown good.' } };
    const unitPrice = good.referencePriceOboles;

    // Verrou d'agora de chaque monde concerné, dans l'ordre des identifiants, avant toute ligne : comme un
    // ordre, la demande des PNJ ou l'entretien, qui le prennent d'abord. Un monde apparu entre la lecture
    // et les verrous est verrouillé ensuite.
    const locked = new Set<string>();
    const lockWorlds = async (worldIds: Iterable<string>) => {
      for (const worldId of [...new Set(worldIds)].filter((id) => !locked.has(id)).sort()) {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
          trx,
        );
        locked.add(worldId);
      }
    };
    const concerned = await sql<{ world_id: string }>`
      select world_id from game.inventories where good_id = ${goodId} and quantity > 0
      union select world_id from game.orders where good_id = ${goodId} and status = 'open'`.execute(
      trx,
    );
    await lockWorlds(concerned.rows.map((row) => row.world_id));
    // Ordre des verrous : ordres, puis stocks, puis, maison par maison, trésorerie puis séquestre.
    // `market.cancelOrder`, qui ne prend pas le verrou d'agora, verrouille son ordre, puis la trésorerie,
    // puis le séquestre : même sens, pas d'interblocage. Un ordre placé, la demande des PNJ et
    // l'entretien prennent d'abord le verrou d'agora de leur monde, que le rachat tient : ils l'attendent,
    // quel que soit l'ordre dans lequel ils verrouillent ensuite stocks, ordres et comptes.
    const orders = await trx
      .selectFrom('game.orders')
      .select(['id', 'world_id', 'house_id', 'city_id', 'side', 'price', 'remaining'])
      .where('good_id', '=', goodId)
      .where('status', '=', 'open')
      .orderBy('id')
      .forUpdate()
      .execute();
    const stocks = await trx
      .selectFrom('game.inventories')
      .select(['id', 'world_id', 'house_id', 'quantity'])
      .where('good_id', '=', goodId)
      .where('quantity', '>', '0')
      .orderBy('id')
      .forUpdate()
      .execute();
    // Cas rare : le premier stock ou le premier ordre ouvert du bien dans un monde a été validé entre la
    // lecture des mondes et les verrous ci-dessus. Le verrou d'agora de ce monde est alors pris après ses
    // lignes, hors de l'ordre habituel : un ordre ou une étape du moteur qui le tient déjà et attend l'une
    // de ces lignes ferait un interblocage, que Postgres rompt en annulant l'une des deux transactions.
    // Si c'est le rachat, il échoue sans rien écrire (`failed`, clé encore utilisable) et se relance. Les
    // lignes lues étant déjà verrouillées, ce qui est racheté reste cohérent dans tous les cas.
    await lockWorlds([...orders, ...stocks].map((row) => row.world_id));

    const plan = planBuyback(
      unitPrice,
      stocks.map((stock) => ({
        inventoryId: stock.id,
        houseId: stock.house_id,
        worldId: stock.world_id,
        quantity: Number(stock.quantity),
      })),
      orders.map((order) => ({
        orderId: order.id,
        houseId: order.house_id,
        worldId: order.world_id,
        cityId: order.city_id,
        side: order.side,
        price: Number(order.price),
        remaining: Number(order.remaining),
      })),
    );
    if (!sameBuybackTotals(plan.totals, expected)) {
      const { houses, units, cancelledOrders, oboles } = plan.totals;
      const message = `The holdings changed: ${houses} houses, ${units} units, ${cancelledOrders} open orders, ${oboles} oboles.`;
      return { ok: false, error: { code: 'BUYBACK_CHANGED', message } };
    }

    // 1. Ordres annulés : la base lève la réservation d'une vente (déclencheur des ordres).
    const ids = orders.map((order) => order.id);
    if (ids.length > 0) {
      await trx
        .updateTable('game.orders')
        .set({ status: 'cancelled' })
        .where('id', 'in', ids)
        .execute();
    }
    const faucets = new Map(
      (
        await trx
          .selectFrom('game.accounts')
          .select(['id', 'world_id'])
          .where('kind', '=', 'system')
          .where('system_key', '=', FAUCET)
          .where('world_id', 'in', [...locked])
          .execute()
      ).map((account) => [account.world_id, account.id]),
    );
    for (const house of plan.houses) {
      // La trésorerie d'abord, verrouillée avant toute ligne, puis le séquestre : comme `market.cancelOrder`.
      const accountOf = (kind: 'house' | 'escrow') =>
        trx
          .selectFrom('game.accounts')
          .select('id')
          .where('house_id', '=', house.houseId)
          .where('kind', '=', kind);
      const { id: treasury } = await accountOf('house').forUpdate().executeTakeFirstOrThrow();
      const post = async (kind: string, from: string, amount: number, meta: object) => {
        const entry = await trx
          .insertInto('game.ledger_entries')
          .values({ world_id: house.worldId, kind, meta: JSON.stringify(meta) })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('game.ledger_lines')
          .values([
            { entry_id: entry.id, account_id: from, amount: -amount },
            { entry_id: entry.id, account_id: treasury, amount },
          ])
          .execute();
        return entry.id;
      };
      // Séquestre de ses achats annulés, rendu en une écriture, comme `market.cancelOrder`.
      if (house.escrowReleasedOboles > 0) {
        const { id: escrow } = await accountOf('escrow').executeTakeFirstOrThrow();
        const meta = { houseId: house.houseId };
        await post('market.escrow_release', escrow, house.escrowReleasedOboles, meta);
      }
      // 2. Rachat : le robinet de son monde paie la maison, son stock quitte la circulation.
      if (house.units > 0) {
        const faucet = faucets.get(house.worldId);
        if (!faucet) throw new Error(`World ${house.worldId} has no ${FAUCET} account`);
        const { houseId, units } = house;
        const meta = { houseId, goodId, units, unitPriceOboles: unitPrice, boughtBackBy: userId };
        const entryId = await post(KIND, faucet, house.oboles, meta);
        await trx
          .insertInto('game.stock_ledger')
          .values(
            house.stocks.map((stock) => ({
              world_id: house.worldId,
              good_id: goodId,
              quantity: stock.quantity,
              from_inventory_id: stock.inventoryId,
              to_system: RETIRED,
              kind: KIND,
              ledger_entry_id: entryId,
            })),
          )
          .execute();
      }
      // 3. Un événement par maison concernée ; chaque ordre annulé l'est aussi, comme par son joueur.
      for (const { orderId, cityId, side, remaining } of house.orders) {
        const payload = {
          orderId,
          houseId: house.houseId,
          cityId,
          goodId,
          side,
          released: remaining,
        };
        emit({ type: 'OrderCancelled', payload });
      }
      const { houseId, worldId, units, oboles, cancelledOrders } = house;
      const payload = { houseId, worldId, goodId, units, oboles, cancelledOrders };
      emit({
        type: 'GoodBoughtBack',
        payload: { ...payload, unitPriceOboles: unitPrice, boughtBackBy: userId },
      });
    }
    // Le résultat nomme chaque maison : le journal d'audit le rend tel quel.
    const houses = plan.houses.map(({ stocks: _stocks, orders: _orders, ...house }) => house);
    const data = { goodId, unitPriceOboles: unitPrice, totals: plan.totals, houses };
    return { ok: true, data };
  },
});

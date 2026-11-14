import {
  classDemand,
  marketTax,
  matchNpcDemand,
  NEUTRAL_QUALITY,
  npcGoodBudget,
  type SystemAccountKey,
} from '@oikos/sim';
import { sql } from 'kysely';
import type { TickStep } from '../tick';

/** Compte système qui crée la monnaie des achats de PNJ (docs/specs/05-economie.md, 5.5). */
const FAUCET: SystemAccountKey = 'faucet_npc_purchases';
/** Puits de la part détruite de la taxe de marché (5.3). */
const TAX_SINK: SystemAccountKey = 'sink_market_tax';
/** Puits de stock : ce que les PNJ achètent est consommé. */
const CONSUMPTION = 'npc_consumption';

/**
 * Demande finale des PNJ (5.2). Pour chaque cité du monde connue de la configuration et chaque bien d'un
 * panier, les PNJ achètent dans le carnet de la moins chère à la plus chère des ventes en attente, dans la
 * limite de leur demande à ce prix, de leur budget du tick et de leur prix de réserve. Chaque achat est
 * payé par le robinet au grand livre, enregistré comme échange sans ordre d'achat, puis consommé par le
 * journal des stocks. La même écriture prélève la taxe de marché sur le vendeur, comme entre joueurs : le
 * budget des PNJ se compte en brut, le vendeur reçoit le net. L'étape ne tire aucun hasard : même état, même configuration, mêmes achats.
 */
export const npcDemand: TickStep = {
  name: 'npcDemand',
  async run({ trx, worldId, config }) {
    const goods = new Map(config.goods.map((good) => [good.id, good]));
    const referencePrice = (goodId: string) => goods.get(goodId)?.referencePriceOboles ?? 0;
    const basketGoods = [
      ...new Set(config.npcClasses.flatMap((c) => c.basket.map((entry) => entry.goodId))),
    ].sort();
    const cities = await trx
      .selectFrom('game.cities')
      .select(['id', 'slug'])
      .where('world_id', '=', worldId)
      .orderBy('slug')
      .execute();
    const markets: { city: string; goodId: string; units: number; spent: number }[] = [];

    // Même verrou que les achats des joueurs : un carnet n'est apparié que par une transaction à la fois.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    // Comptes du monde lus au premier besoin : le robinet, le puits de la taxe, le trésor de chaque cité.
    const accountIds = new Map<string, string>();
    const accountOf = async (column: 'system_key' | 'city_id', value: string) => {
      const known = accountIds.get(value);
      if (known) return known;
      const { id } = await trx
        .selectFrom('game.accounts')
        .select('id')
        .where('world_id', '=', worldId)
        .where(column, '=', value)
        .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no ${value} account`));
      accountIds.set(value, id);
      return id;
    };
    for (const city of cities) {
      const population = config.cities.find((entry) => entry.id === city.slug)?.population;
      if (!population) continue;
      const classes = config.npcClasses.map((npcClass) => ({
        ...npcClass,
        population: population[npcClass.id] ?? 0,
      }));
      for (const goodId of basketGoods) {
        const good = goods.get(goodId);
        if (!good) continue;
        const reserve = Math.floor(good.referencePriceOboles * config.market.npcMaxPriceFactor);
        const asks = await trx
          .selectFrom('game.orders')
          .select(['id', 'house_id', 'price', 'remaining'])
          .where('city_id', '=', city.id)
          .where('good_id', '=', goodId)
          .where('side', '=', 'sell')
          .where('status', '=', 'open')
          .where('price', '<=', String(reserve))
          .orderBy('price')
          .orderBy('seq')
          .forUpdate()
          .execute();
        // Rien à acheter : la demande non servie faute d'offre n'est pas reportée, le report ne bouge pas.
        if (asks.length === 0) continue;

        const carried = await trx
          .selectFrom('game.npc_demand_carry')
          .select('carry')
          .where('city_id', '=', city.id)
          .where('good_id', '=', goodId)
          .executeTakeFirst();
        const purchase = matchNpcDemand({
          asks: asks.map((ask) => ({
            orderId: ask.id,
            price: Number(ask.price),
            quantity: Number(ask.remaining),
          })),
          demandAt: (price) =>
            classes.reduce((sum, npcClass) => {
              const entry = npcClass.basket.find((wanted) => wanted.goodId === goodId);
              if (!entry) return sum;
              return (
                sum +
                classDemand({
                  quantityPerThousand: entry.quantityPerThousand,
                  population: npcClass.population,
                  price,
                  referencePrice: good.referencePriceOboles,
                  elasticity: good.elasticity,
                  qualitySensitivity: npcClass.qualitySensitivity,
                  quality: NEUTRAL_QUALITY,
                })
              );
            }, 0),
          budget: npcGoodBudget(classes, goodId, referencePrice),
          carry: carried?.carry ?? 0,
        });

        const sellers = new Map(asks.map((ask) => [ask.id, ask.house_id]));
        for (const fill of purchase.fills) {
          const sellerId = sellers.get(fill.orderId) ?? '';
          const faucet = await accountOf('system_key', FAUCET);
          const account = await trx
            .selectFrom('game.accounts')
            .select('id')
            .where('house_id', '=', sellerId)
            .where('kind', '=', 'house')
            .executeTakeFirstOrThrow();
          const origin = await trx
            .selectFrom('game.inventories')
            .select('id')
            .where('house_id', '=', sellerId)
            .where('city_id', '=', city.id)
            .where('good_id', '=', goodId)
            .executeTakeFirstOrThrow();
          const amount = fill.price * fill.quantity;
          const tax = marketTax(amount, config.marketTax);
          // Une ligne nulle n'est pas une ligne : part nulle, ou vente d'une obole que la taxe prend entière.
          const lines = [{ account_id: faucet, amount: -amount }];
          if (tax.net > 0) lines.push({ account_id: account.id, amount: tax.net });
          if (tax.burned > 0)
            lines.push({ account_id: await accountOf('system_key', TAX_SINK), amount: tax.burned });
          if (tax.treasury > 0)
            lines.push({ account_id: await accountOf('city_id', city.id), amount: tax.treasury });
          const entry = await trx
            .insertInto('game.ledger_entries')
            .values({ world_id: worldId, kind: 'npc.purchase' })
            .returning('id')
            .executeTakeFirstOrThrow();
          await trx
            .insertInto('game.ledger_lines')
            .values(lines.map((line) => ({ entry_id: entry.id, ...line })))
            .execute();
          // L'échange d'abord (il libère la réservation du vendeur), la consommation ensuite.
          await trx
            .insertInto('game.trades')
            .values({
              world_id: worldId,
              sell_order_id: fill.orderId,
              buy_order_id: null,
              price: fill.price,
              quantity: fill.quantity,
              ledger_entry_id: entry.id,
            })
            .execute();
          await trx
            .insertInto('game.stock_ledger')
            .values({
              world_id: worldId,
              good_id: goodId,
              quantity: fill.quantity,
              from_inventory_id: origin.id,
              to_system: CONSUMPTION,
              kind: 'npc.purchase',
              ledger_entry_id: entry.id,
            })
            .execute();
        }
        await trx
          .insertInto('game.npc_demand_carry')
          .values({ world_id: worldId, city_id: city.id, good_id: goodId, carry: purchase.carry })
          .onConflict((conflict) =>
            conflict
              .columns(['city_id', 'good_id'])
              .doUpdateSet({ carry: purchase.carry, updated_at: sql`now()` }),
          )
          .execute();
        if (purchase.fills.length > 0) {
          markets.push({
            city: city.slug,
            goodId,
            units: purchase.fills.reduce((sum, fill) => sum + fill.quantity, 0),
            spent: purchase.spent,
          });
        }
      }
    }
    return {
      units: markets.reduce((sum, market) => sum + market.units, 0),
      spent: markets.reduce((sum, market) => sum + market.spent, 0),
      markets,
    };
  },
};

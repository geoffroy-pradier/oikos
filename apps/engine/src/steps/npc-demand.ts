import { decreeProposalSchema, tradeExecutedSchema } from '@oikos/contracts';
import { cityRates, type Db } from '@oikos/db';
import {
  addBoosts,
  boostedBudget,
  boostedDemand,
  caravanDemandBoosts,
  classDemand,
  festivalDemandBoosts,
  gameDayAt,
  marketTax,
  matchNpcDemand,
  NEUTRAL_QUALITY,
  npcGoodBudget,
  vitalMeasure,
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
 * payé par le robinet au grand livre, enregistré comme échange sans ordre d'achat, annoncé par un événement
 * de domaine `TradeExecuted`, puis consommé par le
 * journal des stocks. La même écriture prélève la taxe de marché de la cité sur le vendeur, comme entre joueurs : le
 * budget des PNJ se compte en brut, le vendeur reçoit le net. L'étape ne tire aucun hasard : même état, même configuration, mêmes achats.
 *
 * Demande et budget suivent la population courante de la cité (`game.npc_population`) : une classe sans
 * état y naît à la population de la configuration, qui ne sert plus ensuite que de référence aux bornes.
 * Chaque tick joué pendant son intervalle ajoute à la mesure du jour de jeu ce que chaque classe demandait
 * de ses biens vitaux et ce qui lui a été servi, marché vide compris : la clôture suivante en tire la
 * couverture. Un tick rattrapé achète mais ne mesure rien : après une panne, les ticks rejoués d'affilée
 * vident un carnet que personne n'a pu regarnir, et compteraient comme une pénurie.
 *
 * Pendant une fête de la cité (7.5, #263), la demande et le budget de chacun de ses biens montent de la hausse
 * que `festivalDemandBoosts` calcule pour le jour de jeu du tick ; le besoin mesuré, lui, ne change pas.
 * Pendant une caravane étrangère de la cité (7.4, #267), celle de son bien monte en plus de l'ampleur de la plus
 * forte caravane du bien : les deux hausses s'ajoutent, chacune bornée par sa propre règle.
 */
export const npcDemand: TickStep = {
  name: 'npcDemand',
  async run({ trx, worldId, scheduledAt, config, catchUp }) {
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
    // Taxe de chaque cité (5.6), lue sous ce verrou : celui que prend la clôture qui applique un décret.
    const rates = await cityRates(trx, worldId, config);
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
        // Le trésor de la cité, jamais sa bourse des PNJ (#632), quel que soit le rôle de la connexion.
        .where('npc_purse', '=', false)
        .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no ${value} account`));
      accountIds.set(value, id);
      return id;
    };
    for (const city of cities) {
      const initial = config.cities.find((entry) => entry.id === city.slug)?.population;
      if (!initial) continue;
      const rateBps = rates.get(city.id)?.marketTaxRateBps;
      if (rateBps === undefined) throw new Error(`No market tax rate for city ${city.id}`);
      const rule = { rateBps, burnShareBps: config.marketTax.burnShareBps };
      const state = await trx
        .selectFrom('game.npc_population')
        .select(['class_id', 'population'])
        .where('city_id', '=', city.id)
        .execute();
      const living = new Map(state.map((row) => [row.class_id, row.population]));
      const classes = config.npcClasses.map((npcClass) => ({
        ...npcClass,
        population: living.get(npcClass.id) ?? initial[npcClass.id] ?? 0,
      }));
      // Seules les classes sans état sont insérées : une ligne existante n'est jamais touchée ici, et
      // le tick n'attend donc pas une clôture qui la fait évoluer (elle attend, elle, les appariements).
      const born = classes.filter((npcClass) => !living.has(npcClass.id));
      if (born.length > 0)
        await trx
          .insertInto('game.npc_population')
          .values(
            born.map(({ id, population }) => ({
              world_id: worldId,
              city_id: city.id,
              class_id: id,
              population,
            })),
          )
          .execute();
      const gameDay = gameDayAt(scheduledAt, config.clock);
      const caravans = await trx
        .selectFrom('game.world_events')
        .select(['good_id', 'start_day', 'end_day', 'magnitude_bps'])
        .where('city_id', '=', city.id)
        .where('model', '=', 'caravan')
        .where('start_day', '<=', gameDay)
        .where('end_day', '>', gameDay)
        .execute();
      const boosts = addBoosts(
        festivalDemandBoosts(
          await festivalsOf(trx, city.id, gameDay, config.decrees?.models.festival?.maxDays),
          gameDay,
          config.decrees?.models.festival,
        ),
        caravanDemandBoosts(
          caravans.map((row) => ({
            goodId: row.good_id,
            startDay: row.start_day,
            endDay: row.end_day,
            magnitudeBps: row.magnitude_bps,
          })),
          gameDay,
        ),
      );
      const bought = new Map<string, number>();
      for (const goodId of basketGoods) {
        const good = goods.get(goodId);
        if (!good) continue;
        const boostBps = boosts.get(goodId) ?? 0;
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
                  // Q est proportionnelle à Q0 : relever Q0 relève la demande de la fête.
                  quantityPerThousand: boostedDemand(entry.quantityPerThousand, boostBps),
                  population: npcClass.population,
                  price,
                  referencePrice: good.referencePriceOboles,
                  elasticity: good.elasticity,
                  qualitySensitivity: npcClass.qualitySensitivity,
                  quality: NEUTRAL_QUALITY,
                })
              );
            }, 0),
          budget: boostedBudget(npcGoodBudget(classes, goodId, referencePrice), boostBps),
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
          const tax = marketTax(amount, rule);
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
          const trade = await trx
            .insertInto('game.trades')
            .values({
              world_id: worldId,
              sell_order_id: fill.orderId,
              buy_order_id: null,
              price: fill.price,
              quantity: fill.quantity,
              ledger_entry_id: entry.id,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          // Même événement qu'entre joueurs, sans ordre d'achat : c'est ce qui désigne un achat de PNJ.
          const event = tradeExecutedSchema.parse({
            type: 'TradeExecuted',
            payload: {
              tradeId: trade.id,
              cityId: city.id,
              goodId,
              sellOrderId: fill.orderId,
              buyOrderId: null,
              price: fill.price,
              quantity: fill.quantity,
            },
          });
          await trx
            .insertInto('game.domain_events')
            .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
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
          const units = purchase.fills.reduce((sum, fill) => sum + fill.quantity, 0);
          bought.set(goodId, units);
          markets.push({ city: city.slug, goodId, units, spent: purchase.spent });
        }
      }
      if (!catchUp)
        await trx
          .insertInto('game.npc_vital_coverage')
          .values(
            vitalMeasure(classes, bought).map(({ classId, served, demanded }) => ({
              world_id: worldId,
              city_id: city.id,
              class_id: classId,
              game_day: gameDay,
              served,
              demanded,
            })),
          )
          .onConflict((conflict) =>
            conflict.columns(['city_id', 'class_id', 'game_day']).doUpdateSet({
              served: sql<number>`npc_vital_coverage.served + excluded.served`,
              demanded: sql<number>`npc_vital_coverage.demanded + excluded.demanded`,
            }),
          )
          .execute();
    }
    return {
      units: markets.reduce((sum, market) => sum + market.units, 0),
      spent: markets.reduce((sum, market) => sum + market.spent, 0),
      markets,
    };
  },
};

/**
 * Fêtes appliquées d'une cité qui peuvent durer jusqu'au jour de jeu donné : réglées ce jour ou dans les
 * `maxDays - 1` jours d'avant. Sans modèle de fête ouvert, aucune. Une fête aux paramètres illisibles (écrite
 * hors de l'API) est journalisée et ignorée : elle ne doit pas arrêter les achats des PNJ du monde.
 */
async function festivalsOf(trx: Db, cityId: string, gameDay: number, maxDays: number | undefined) {
  if (maxDays === undefined) return [];
  const rows = await trx
    .selectFrom('game.decrees')
    .select(['id', 'params', 'settled_day'])
    .where('city_id', '=', cityId)
    .where('model', '=', 'festival')
    .where('status', '=', 'applied')
    .where('settled_day', '<=', gameDay)
    .where('settled_day', '>', gameDay - maxDays)
    .execute();
  return rows.flatMap((row) => {
    const parsed = decreeProposalSchema.safeParse({ model: 'festival', params: row.params });
    if (!parsed.success || parsed.data.model !== 'festival' || row.settled_day === null) {
      console.error(`Festival ${row.id} is unreadable: no demand boost`);
      return [];
    }
    return [{ ...parsed.data.params, settledDay: row.settled_day }];
  });
}

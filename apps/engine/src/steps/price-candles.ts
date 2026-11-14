import { priceCandles, type TradePrint } from '@oikos/sim';
import type { TickStep } from '../tick';

/** Lignes par instruction d'écriture : loin de la limite de paramètres d'une requête. */
const BATCH = 500;

/**
 * Historique des prix (docs/specs/05-economie.md, 5.3). Résume en chandeliers les échanges du monde, par
 * cité et par bien, pour la durée de la configuration. L'étape repart du début de la période qui précède
 * le dernier chandelier de la série : un échange daté de son début de transaction peut être validé après
 * le calcul de sa période. Une série vide (monde neuf, durée changée) est reconstruite depuis le premier
 * échange. Chaque chandelier est recalculé en entier depuis les échanges puis remplace la ligne de même
 * clé : rejouer l'étape ne double rien. Elle ne lit ni l'horloge ni le hasard.
 */
export const priceCandlesStep: TickStep = {
  name: 'priceCandles',
  async run({ trx, worldId, config }) {
    const periodSeconds = config.priceHistory.candleMinutes * 60;
    const { latest } = await trx
      .selectFrom('game.price_candles')
      .select((eb) => eb.fn.max('period_start').as('latest'))
      .where('world_id', '=', worldId)
      .where('period_seconds', '=', periodSeconds)
      .executeTakeFirstOrThrow();
    let query = trx
      .selectFrom('game.trades as t')
      .innerJoin('game.orders as o', 'o.id', 't.sell_order_id')
      .select(['o.city_id', 'o.good_id', 't.price', 't.quantity', 't.created_at'])
      .where('t.world_id', '=', worldId)
      .orderBy('t.seq');
    if (latest)
      query = query.where('t.created_at', '>=', new Date(latest.getTime() - periodSeconds * 1000));

    const markets = new Map<string, { cityId: string; goodId: string; trades: TradePrint[] }>();
    for (const row of await query.execute()) {
      const key = `${row.city_id}:${row.good_id}`;
      const market = markets.get(key) ?? { cityId: row.city_id, goodId: row.good_id, trades: [] };
      markets.set(key, market);
      market.trades.push({
        at: row.created_at.getTime(),
        price: Number(row.price),
        quantity: Number(row.quantity),
      });
    }
    const rows = [...markets.values()].flatMap(({ cityId, goodId, trades }) =>
      priceCandles(trades, periodSeconds).map(({ periodStart, ...values }) => ({
        world_id: worldId,
        city_id: cityId,
        good_id: goodId,
        period_seconds: periodSeconds,
        period_start: new Date(periodStart),
        ...values,
      })),
    );
    for (let start = 0; start < rows.length; start += BATCH) {
      await trx
        .insertInto('game.price_candles')
        .values(rows.slice(start, start + BATCH))
        .onConflict((conflict) =>
          conflict
            .columns(['city_id', 'good_id', 'period_seconds', 'period_start'])
            .doUpdateSet((eb) => ({
              open: eb.ref('excluded.open'),
              high: eb.ref('excluded.high'),
              low: eb.ref('excluded.low'),
              close: eb.ref('excluded.close'),
              volume: eb.ref('excluded.volume'),
              turnover: eb.ref('excluded.turnover'),
            })),
        )
        .execute();
    }
    // Chandeliers écrits ou réécrits : ceux des périodes relues, pas seulement les nouveaux.
    return { periodSeconds, candles: rows.length };
  },
};

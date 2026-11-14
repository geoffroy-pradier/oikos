import { observedPrice } from '@oikos/sim';
import type { TickStep } from '../tick';

/**
 * Prix de référence observé (docs/specs/05-economie.md, 5.3). Pour chaque marché du monde, le prix moyen
 * pondéré par les volumes des chandeliers de la série en cours dont la période commence dans la fenêtre
 * de la configuration, fermée par l'instant de jeu du tick. Un marché sans échange dans la fenêtre garde
 * sa ligne : son dernier prix observé, à sa date. L'étape passe après celle des chandeliers et remplace
 * la ligne de chaque marché : rejouer ne double rien.
 */
export const observedPricesStep: TickStep = {
  name: 'observedPrices',
  async run({ trx, worldId, scheduledAt, config }) {
    const windowSeconds = config.priceHistory.referenceWindowHours * 3600;
    const markets = await trx
      .selectFrom('game.price_candles')
      .select(['city_id', 'good_id'])
      .select((eb) => [eb.fn.sum('volume').as('volume'), eb.fn.sum('turnover').as('turnover')])
      .where('world_id', '=', worldId)
      .where('period_seconds', '=', config.priceHistory.candleMinutes * 60)
      .where('period_start', '>=', new Date(scheduledAt.getTime() - windowSeconds * 1000))
      .groupBy(['city_id', 'good_id'])
      .execute();
    const rows = markets.flatMap((market) => {
      const observed = observedPrice([
        { volume: Number(market.volume), turnover: Number(market.turnover) },
      ]);
      if (!observed) return [];
      return {
        world_id: worldId,
        city_id: market.city_id,
        good_id: market.good_id,
        ...observed,
        window_seconds: windowSeconds,
        observed_at: scheduledAt,
      };
    });
    if (rows.length > 0) {
      await trx
        .insertInto('game.observed_prices')
        .values(rows)
        .onConflict((conflict) =>
          conflict.columns(['city_id', 'good_id']).doUpdateSet((eb) => ({
            price: eb.ref('excluded.price'),
            volume: eb.ref('excluded.volume'),
            window_seconds: eb.ref('excluded.window_seconds'),
            observed_at: eb.ref('excluded.observed_at'),
          })),
        )
        .execute();
    }
    return { windowSeconds, markets: rows.length };
  },
};

import { decreeAppliedSchema, decreeProposalSchema } from '@oikos/contracts';
import { cityRatesOf } from '@oikos/db';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/** Modèles que cette étape applique : les taux. Les dépenses (grands travaux, fête) : `decreeSpending`. */
const RATE_MODELS = ['market_tax_rate', 'port_dues'] as const;

/**
 * Application des décrets de taux (5.6, 6.3) : chaque décret adopté de taux de la taxe de marché ou de
 * coefficient du droit de port du monde passe à `applied`, une fois, dans l'ordre de la fin de leur vote ; le
 * dernier appliqué fait le taux de sa cité. La base n'admet qu'une application par décret et un seul
 * événement `DecreeApplied`. Revalidé contre la configuration de la clôture, un décret sorti des bornes depuis
 * son vote s'applique et vaut la borne la plus proche ; un modèle qu'elle ne borne plus le laisse sans effet.
 * L'événement dit la valeur votée et la valeur en vigueur, lue par le calcul des commandes (`cityRatesOf`).
 * Le verrou de l'agora est pris avant d'appliquer, comme le prennent les commandes et le tick avant de lire
 * un taux : un échange ne se règle pas, pendant la clôture, au taux qu'elle remplace.
 */
export const decreeApplication: CloseStep = {
  name: 'decreeApplication',
  async run({ trx, worldId, config, at }) {
    const summary = { applied: 0, bounded: 0, unreadable: 0 };
    const due = await trx
      .selectFrom('game.decrees')
      .select(['id', 'city_id', 'model', 'params'])
      .where('world_id', '=', worldId)
      .where('status', '=', 'adopted')
      .where('model', 'in', [...RATE_MODELS])
      .orderBy('voting_closes_at')
      .orderBy('id')
      .execute();
    if (due.length === 0) return summary;
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    for (const row of due) {
      at?.(`decree ${row.id}`);
      // Encore adopté sous le verrou : un décret déjà appliqué (étape jouée hors du verrou de la clôture du
      // monde) est sauté au lieu de faire échouer la clôture entière.
      const locked = await trx
        .selectFrom('game.decrees')
        .select('id')
        .where('id', '=', row.id)
        .where('status', '=', 'adopted')
        .forUpdate()
        .executeTakeFirst();
      if (!locked) continue;
      // L'API valide un décret à sa proposition, et il est immuable. Illisible malgré tout (écrit hors de
      // l'API) : laissé adopté, compté et journalisé, sans arrêter la clôture du monde à chaque passage.
      const parsed = decreeProposalSchema.safeParse({ model: row.model, params: row.params });
      if (!parsed.success) {
        console.error(
          `Decree ${row.id} has unreadable parameters: left adopted`,
          parsed.error.issues,
        );
        summary.unreadable += 1;
        continue;
      }
      const decree = parsed.data;
      await trx
        .updateTable('game.decrees')
        .set({ status: 'applied', applied_at: sql<Date>`now()` })
        .where('id', '=', row.id)
        .execute();
      const rates = await cityRatesOf(trx, worldId, row.city_id, config);
      const [voted, inForceBps] =
        decree.model === 'market_tax_rate'
          ? [decree.params.rateBps, rates.marketTaxRateBps]
          : decree.model === 'port_dues'
            ? [decree.params.coefficientBps, rates.portDuesCoefficientBps]
            : [];
      if (inForceBps === undefined) throw new Error(`Decree ${row.id} is not a rate decree`);
      const event = decreeAppliedSchema.parse({
        type: 'DecreeApplied',
        payload: { decreeId: row.id, cityId: row.city_id, decree, inForceBps },
      });
      await trx
        .insertInto('game.domain_events')
        .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
        .execute();
      summary.applied += 1;
      if (inForceBps !== voted) summary.bounded += 1;
    }
    return summary;
  },
};

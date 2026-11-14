import { upkeepSettledSchema } from '@oikos/contracts';
import { dailyUpkeep, settleUpkeep, type SystemAccountKey } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/** Puits de l'entretien des sites (docs/specs/05-economie.md, 5.5). */
const SINK: SystemAccountKey = 'sink_upkeep';

/**
 * Entretien quotidien des sites (5.5). Chaque site qui existait à l'instant de la clôture doit un
 * jour d'entretien, à l'arrêt ou non. Par maison, `settleUpkeep` décide de ce que la trésorerie
 * paie ; le total part au puits par une écriture du grand livre, qui enregistre la décision (maison,
 * jour de jeu, sites payés). Un site impayé s'arrête, un site à l'arrêt qui est payé repart. Un site
 * dont la recette n'est plus dans la configuration n'a plus de type, donc pas d'entretien.
 * Chaque maison concernée reçoit un événement de domaine `UpkeepSettled`.
 */
export const siteUpkeep: CloseStep = {
  name: 'siteUpkeep',
  async run({ trx, worldId, gameDay, closeAt, config }) {
    const { coefficientBps, dailyOboles } = config.sites.upkeep;
    const typeOf = new Map(config.recipes.map((recipe) => [recipe.id, recipe.siteType]));
    // Ordre des verrous : d'abord les appariements du monde (ils touchent plusieurs trésoreries à la
    // fois ; la relance d'un site ne prend pas ce verrou), puis, dans le même ordre que la relance,
    // le puits, chaque trésorerie et ses sites.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    const sink = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', worldId)
      .where('system_key', '=', SINK)
      .forUpdate()
      .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no ${SINK} account`));
    const houses = await trx
      .selectFrom('game.sites')
      .select('house_id')
      .distinct()
      .where('world_id', '=', worldId)
      .where('created_at', '<', closeAt)
      .orderBy('house_id')
      .execute();
    const totals = {
      houses: 0,
      paidOboles: 0,
      sitesPaid: 0,
      sitesUnpaid: 0,
      halted: 0,
      resumed: 0,
    };

    for (const { house_id: houseId } of houses) {
      const account = await trx
        .selectFrom('game.accounts')
        .select(['id', 'balance'])
        .where('house_id', '=', houseId)
        .where('kind', '=', 'house')
        .forUpdate()
        .executeTakeFirstOrThrow();
      const sites = await trx
        .selectFrom('game.sites')
        .select(['id', 'recipe_id', 'halted_at'])
        .where('house_id', '=', houseId)
        .where('created_at', '<', closeAt)
        .orderBy('created_at')
        .orderBy('id')
        .forUpdate()
        .execute();
      const dues = sites.map((site) => {
        const type = typeOf.get(site.recipe_id);
        return {
          siteId: site.id,
          oboles: type ? dailyUpkeep(dailyOboles[type], coefficientBps) : 0,
        };
      });
      const { paid, unpaid, total } = settleUpkeep(Number(account.balance), dues);
      const haltedBefore = new Set(sites.filter((site) => site.halted_at).map((site) => site.id));
      const halted = unpaid.map((due) => due.siteId).filter((id) => !haltedBefore.has(id));
      const resumed = paid.map((due) => due.siteId).filter((id) => haltedBefore.has(id));
      // Rien de dû (configuration sans entretien) et rien à relancer : la maison n'est pas concernée.
      if (total === 0 && unpaid.length === 0 && resumed.length === 0) continue;

      if (total > 0) {
        const entry = await trx
          .insertInto('game.ledger_entries')
          .values({
            world_id: worldId,
            kind: 'upkeep.daily',
            meta: JSON.stringify({ houseId, gameDay, sites: paid.filter((due) => due.oboles > 0) }),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('game.ledger_lines')
          .values([
            { entry_id: entry.id, account_id: account.id, amount: -total },
            { entry_id: entry.id, account_id: sink.id, amount: total },
          ])
          .execute();
      }
      // L'arrêt et la reprise sont datés par la base ; à la reprise, elle exige que le cycle avance
      // exactement de la durée de l'arrêt, comptée en secondes (garde des sites).
      if (halted.length > 0)
        await trx
          .updateTable('game.sites')
          // Un site récolté ou changé de recette pendant cette clôture a un cycle postérieur à son
          // début : l'arrêt est alors daté de ce cycle, que la garde admet dans la transaction.
          .set({ halted_at: sql<Date>`greatest(now(), cycle_started_at)` })
          .where('id', 'in', halted)
          .execute();
      if (resumed.length > 0)
        await trx
          .updateTable('game.sites')
          .set({
            cycle_started_at: sql<Date>`cycle_started_at + extract(epoch from now() - halted_at) * interval '1 second'`,
            halted_at: null,
          })
          .where('id', 'in', resumed)
          .execute();
      const event = upkeepSettledSchema.parse({
        type: 'UpkeepSettled',
        payload: { houseId, gameDay, paidOboles: total, paid, unpaid, halted, resumed },
      });
      await trx
        .insertInto('game.domain_events')
        .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
        .execute();
      totals.houses += 1;
      totals.paidOboles += total;
      // Un site au dû nul (recette retirée) est réglé sans rien payer : il n'est pas compté comme payé.
      totals.sitesPaid += paid.filter((due) => due.oboles > 0).length;
      totals.sitesUnpaid += unpaid.length;
      totals.halted += halted.length;
      totals.resumed += resumed.length;
    }
    return totals;
  },
};

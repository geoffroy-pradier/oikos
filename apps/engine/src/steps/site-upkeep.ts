import { cityDailyWageOboles } from '@oikos/config';
import { upkeepSettledSchema } from '@oikos/contracts';
import { settleUpkeep, siteDailyDue, sumDailyDues, type SystemAccountKey } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Puits du dû quotidien des sites (docs/specs/05-economie.md, 5.5), dans l'ordre où ils sont verrouillés,
 * le même que la relance d'un site : l'entretien, puis les salaires (4.4).
 */
const SINKS = ['sink_upkeep', 'sink_npc_wages'] as const satisfies readonly SystemAccountKey[];

/**
 * Entretien et salaires quotidiens des sites (5.5, 4.4). Chaque site qui existait à l'instant de la
 * clôture doit un jour d'entretien, plus le salaire du jour de sa cité pour chacun des travailleurs de sa
 * recette, à l'arrêt ou non. Par maison, `settleUpkeep` décide de ce que la trésorerie paie, chaque site
 * en entier ou pas du tout ; le tout part aux puits par une seule écriture du grand livre, qui enregistre
 * la décision (maison, jour de jeu, sites payés) et porte une ligne de débit de la trésorerie par nature
 * (`upkeep`, `wages`, 4.1), chacune vers son puits. Une part nulle n'a pas de ligne. Un site impayé
 * s'arrête, un site à l'arrêt qui est payé repart. Un site dont la recette n'est plus dans la
 * configuration n'a plus de type ni de travailleurs, donc rien à payer.
 * Chaque maison concernée reçoit un événement de domaine `UpkeepSettled`.
 */
export const siteUpkeep: CloseStep = {
  name: 'siteUpkeep',
  async run({ trx, worldId, gameDay, closeAt, config, at }) {
    const { coefficientBps, dailyOboles } = config.sites.upkeep;
    const recipeOf = new Map(config.recipes.map((recipe) => [recipe.id, recipe]));
    // Ordre des verrous : d'abord les appariements du monde (ils touchent plusieurs trésoreries à la
    // fois ; la relance d'un site ne prend pas ce verrou), puis, dans le même ordre que la relance,
    // le puits, chaque trésorerie et ses sites.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    const lockSink = async (key: (typeof SINKS)[number]) =>
      (
        await trx
          .selectFrom('game.accounts')
          .select('id')
          .where('world_id', '=', worldId)
          .where('system_key', '=', key)
          .forUpdate()
          .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no ${key} account`))
      ).id;
    const upkeepSink = await lockSink(SINKS[0]);
    const wagesSink = await lockSink(SINKS[1]);
    // Salaire du jour de chaque cité du monde : la cité de la configuration porte l'identifiant de son slug.
    const wageOf = new Map(
      (
        await trx
          .selectFrom('game.cities')
          .select(['id', 'slug'])
          .where('world_id', '=', worldId)
          .execute()
      ).map((city) => [city.id, cityDailyWageOboles(config, city.slug)]),
    );
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
      wagesOboles: 0,
      sitesPaid: 0,
      sitesUnpaid: 0,
      halted: 0,
      resumed: 0,
    };

    for (const { house_id: houseId } of houses) {
      // Une maison en erreur fait échouer la clôture du monde : l'erreur la nomme.
      at?.(`house ${houseId}`);
      const account = await trx
        .selectFrom('game.accounts')
        .select(['id', 'balance'])
        .where('house_id', '=', houseId)
        .where('kind', '=', 'house')
        .forUpdate()
        .executeTakeFirstOrThrow();
      const sites = await trx
        .selectFrom('game.sites')
        .select(['id', 'recipe_id', 'city_id', 'halted_at'])
        .where('house_id', '=', houseId)
        .where('created_at', '<', closeAt)
        .orderBy('created_at')
        .orderBy('id')
        .forUpdate()
        .execute();
      const dues = sites.map((site) => {
        const recipe = recipeOf.get(site.recipe_id);
        const { upkeepOboles, wagesOboles, oboles } = recipe
          ? siteDailyDue({
              upkeepBaseOboles: dailyOboles[recipe.siteType],
              coefficientBps,
              workers: recipe.workers,
              wageOboles: wageOf.get(site.city_id) ?? 0,
            })
          : { upkeepOboles: 0, wagesOboles: 0, oboles: 0 };
        return { siteId: site.id, oboles, upkeepOboles, wagesOboles };
      });
      const { paid: settled, unpaid, total } = settleUpkeep(Number(account.balance), dues);
      // Un site au dû nul (recette retirée, ou ni entretien ni salaire) est réglé sans rien payer : il ne
      // figure ni dans l'écriture, ni dans l'événement, ni dans le compte des sites payés.
      const paid = settled.filter((due) => due.oboles > 0);
      // Les lignes de l'écriture, par nature : leur somme est le prélèvement (`sumDailyDues`).
      const lines = sumDailyDues(paid);
      const haltedBefore = new Set(sites.filter((site) => site.halted_at).map((site) => site.id));
      const halted = unpaid.map((due) => due.siteId).filter((id) => !haltedBefore.has(id));
      const resumed = settled.map((due) => due.siteId).filter((id) => haltedBefore.has(id));
      // Rien de dû (configuration sans entretien) et rien à relancer : la maison n'est pas concernée.
      if (total === 0 && unpaid.length === 0 && resumed.length === 0) continue;

      if (total > 0) {
        const entry = await trx
          .insertInto('game.ledger_entries')
          .values({
            world_id: worldId,
            kind: 'upkeep.daily',
            meta: JSON.stringify({ houseId, gameDay, sites: paid }),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const parts = [
          { nature: 'upkeep', sink: upkeepSink, oboles: lines.upkeepOboles },
          { nature: 'wages', sink: wagesSink, oboles: lines.wagesOboles },
        ] as const;
        await trx
          .insertInto('game.ledger_lines')
          .values(
            parts
              .filter((part) => part.oboles > 0)
              .flatMap((part) => [
                {
                  entry_id: entry.id,
                  account_id: account.id,
                  amount: -part.oboles,
                  nature: part.nature,
                },
                { entry_id: entry.id, account_id: part.sink, amount: part.oboles },
              ]),
          )
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
        payload: {
          houseId,
          gameDay,
          paidOboles: total,
          upkeepOboles: lines.upkeepOboles,
          wagesOboles: lines.wagesOboles,
          paid,
          unpaid,
          halted,
          resumed,
        },
      });
      await trx
        .insertInto('game.domain_events')
        .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
        .execute();
      totals.houses += 1;
      totals.paidOboles += total;
      totals.wagesOboles += lines.wagesOboles;
      totals.sitesPaid += paid.length;
      totals.sitesUnpaid += unpaid.length;
      totals.halted += halted.length;
      totals.resumed += resumed.length;
    }
    return totals;
  },
};

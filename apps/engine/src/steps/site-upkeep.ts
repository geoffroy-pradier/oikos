import { cityDailyWageOboles } from '@oikos/config';
import { upkeepSettledSchema } from '@oikos/contracts';
import {
  settlePropertyUpkeep,
  settleShipUpkeep,
  settleUpkeep,
  siteDailyDue,
  sumDailyDues,
  type SystemAccountKey,
} from '@oikos/sim';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Puits du dû quotidien des sites (docs/specs/05-economie.md, 5.5), dans l'ordre où ils sont verrouillés,
 * le même que la relance d'un site : l'entretien, puis les salaires (4.4), puis l'entretien des navires
 * (4.6) et celui des biens immobiliers (4.5), que seule la clôture prélève.
 */
const SINKS = [
  'sink_upkeep',
  'sink_npc_wages',
  'sink_ship_upkeep',
  'sink_property_upkeep',
] as const satisfies readonly SystemAccountKey[];

/**
 * Verrouille les puits de l'entretien dans l'ordre de `SINKS` et rend leurs comptes. Toute étape de la
 * clôture qui verrouille une trésorerie le fait d'abord, après l'agora : la relance d'un site, qui ne prend
 * pas l'agora, verrouille ses puits puis la trésorerie, et l'attendrait sinon pendant qu'elle-même attend.
 */
export async function lockUpkeepSinks(trx: Db, worldId: string) {
  const ids: string[] = [];
  for (const key of SINKS)
    ids.push(
      (
        await trx
          .selectFrom('game.accounts')
          .select('id')
          .where('world_id', '=', worldId)
          .where('system_key', '=', key)
          .forUpdate()
          .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no ${key} account`))
      ).id,
    );
  return ids as [string, string, string, string];
}

/**
 * Entretien et salaires quotidiens des sites (5.5, 4.4). Chaque site qui existait à l'instant de la
 * clôture doit un jour d'entretien, plus le salaire du jour de sa cité pour chacun des travailleurs de sa
 * recette, à l'arrêt ou non. Par maison, `settleUpkeep` décide de ce que la trésorerie paie, chaque site
 * en entier ou pas du tout ; le tout part aux puits par une seule écriture du grand livre, qui enregistre
 * la décision (maison, jour de jeu, sites payés) et porte une ligne de débit de la trésorerie par nature
 * (`upkeep`, `wages`, 4.1), chacune vers son puits. Une part nulle n'a pas de ligne. Un site impayé
 * s'arrête, un site à l'arrêt qui est payé repart. Un site dont la recette n'est plus dans la
 * configuration n'a plus de type ni de travailleurs, donc rien à payer.
 * Ses navires (4.6, #252) sont examinés ensuite, avec ce qui reste de la trésorerie : chacun doit
 * l'entretien d'un jour de sa classe, payé en entier ou pas du tout, par une ligne `upkeep` vers le puits
 * `sink_ship_upkeep` de la même écriture. Un navire impayé est désarmé, un navire désarmé payé est réarmé ;
 * une classe retirée de la configuration ne doit rien.
 * Ses biens immobiliers (4.5, #256) ensuite, achetés avant l'instant de la clôture, dans l'ordre de leur
 * achat : chacun doit l'entretien d'un jour de sa taille, par une ligne `upkeep` vers le puits
 * `sink_property_upkeep`. Un bien impayé ne loge plus personne jusqu'à la clôture qui le paie ; une taille
 * retirée ne doit rien. L'étape parcourt aussi les maisons qui n'ont que des biens.
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
    const [upkeepSink, wagesSink, shipSink, propertySink] = await lockUpkeepSinks(trx, worldId);
    const propertyUpkeepOf = new Map(
      config.properties.sizes.map((size) => [size.id, size.dailyUpkeepOboles]),
    );
    const shipUpkeepOf = new Map(
      config.ships.classes.map((shipClass) => [shipClass.id, shipClass.dailyUpkeepOboles]),
    );
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
    // Les maisons qui avaient un site, un navire ou un bien immobilier à l'instant de la clôture.
    const houses = await trx
      .selectFrom('game.sites')
      .select('house_id')
      .where('world_id', '=', worldId)
      .where('created_at', '<', closeAt)
      .union((ships) =>
        ships
          .selectFrom('game.ships')
          .select('house_id')
          .where('world_id', '=', worldId)
          .where('created_at', '<', closeAt),
      )
      .union((estates) =>
        estates
          .selectFrom('game.properties')
          .select(sql<string>`owner_house_id`.as('house_id'))
          .where('world_id', '=', worldId)
          .where('acquired_at', '<', closeAt),
      )
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
      shipUpkeepOboles: 0,
      shipsPaid: 0,
      shipsUnpaid: 0,
      laidUp: 0,
      rearmed: 0,
      propertyUpkeepOboles: 0,
      propertiesPaid: 0,
      propertiesUnpaid: 0,
      lapsed: 0,
      restored: 0,
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
      const {
        paid: settled,
        unpaid,
        total: sitesTotal,
      } = settleUpkeep(Number(account.balance), dues);
      // Les navires ensuite, dans l'ordre de leur création, avec ce qui reste de la trésorerie.
      const ships = await trx
        .selectFrom('game.ships')
        .select(['id', 'class_id', 'laid_up_at'])
        .where('house_id', '=', houseId)
        .where('created_at', '<', closeAt)
        .orderBy('created_at')
        .orderBy('id')
        .forUpdate()
        .execute();
      const fleet = settleShipUpkeep(
        Number(account.balance) - sitesTotal,
        ships.map((ship) => ({ shipId: ship.id, oboles: shipUpkeepOf.get(ship.class_id) ?? 0 })),
      );
      const paidShips = fleet.paid.filter((due) => due.oboles > 0);
      const laidUpBefore = new Set(ships.filter((ship) => ship.laid_up_at).map((ship) => ship.id));
      const laidUp = fleet.unpaid.map((due) => due.shipId).filter((id) => !laidUpBefore.has(id));
      const rearmed = fleet.paid.map((due) => due.shipId).filter((id) => laidUpBefore.has(id));
      // Les biens immobiliers enfin, dans l'ordre de leur achat, avec ce qui reste encore.
      const estates = await trx
        .selectFrom('game.properties')
        .select(['id', 'size_id', 'upkeep_unpaid_since'])
        .where('owner_house_id', '=', houseId)
        .where('acquired_at', '<', closeAt)
        .orderBy('acquired_at')
        .orderBy('id')
        .forUpdate()
        .execute();
      const estate = settlePropertyUpkeep(
        Number(account.balance) - sitesTotal - fleet.total,
        estates.map((row) => ({
          propertyId: row.id,
          oboles: propertyUpkeepOf.get(row.size_id) ?? 0,
        })),
      );
      const paidEstates = estate.paid.filter((due) => due.oboles > 0);
      const unpaidBefore = new Set(
        estates.filter((row) => row.upkeep_unpaid_since).map((row) => row.id),
      );
      const lapsed = estate.unpaid
        .map((due) => due.propertyId)
        .filter((id) => !unpaidBefore.has(id));
      const restored = estate.paid
        .map((due) => due.propertyId)
        .filter((id) => unpaidBefore.has(id));
      const total = sitesTotal + fleet.total + estate.total;
      // Un site au dû nul (recette retirée, ou ni entretien ni salaire) est réglé sans rien payer : il ne
      // figure ni dans l'écriture, ni dans l'événement, ni dans le compte des sites payés.
      const paid = settled.filter((due) => due.oboles > 0);
      // Les lignes de l'écriture, par nature : leur somme est le prélèvement (`sumDailyDues`).
      const lines = sumDailyDues(paid);
      const haltedBefore = new Set(sites.filter((site) => site.halted_at).map((site) => site.id));
      const halted = unpaid.map((due) => due.siteId).filter((id) => !haltedBefore.has(id));
      const resumed = settled.map((due) => due.siteId).filter((id) => haltedBefore.has(id));
      // Rien de dû (configuration sans entretien) et rien à relancer : la maison n'est pas concernée.
      const touched =
        unpaid.length +
        resumed.length +
        fleet.unpaid.length +
        rearmed.length +
        estate.unpaid.length +
        restored.length;
      if (total === 0 && touched === 0) continue;

      if (total > 0) {
        const entry = await trx
          .insertInto('game.ledger_entries')
          .values({
            world_id: worldId,
            kind: 'upkeep.daily',
            meta: JSON.stringify({
              houseId,
              gameDay,
              sites: paid,
              ...(paidShips.length > 0 && { ships: paidShips }),
              ...(paidEstates.length > 0 && { properties: paidEstates }),
            }),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const parts = [
          { nature: 'upkeep', sink: upkeepSink, oboles: lines.upkeepOboles },
          { nature: 'wages', sink: wagesSink, oboles: lines.wagesOboles },
          { nature: 'upkeep', sink: shipSink, oboles: fleet.total },
          { nature: 'upkeep', sink: propertySink, oboles: estate.total },
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
      // Le désarmement est daté par la base, de la transaction qui l'écrit (garde des navires).
      if (laidUp.length > 0)
        await trx
          .updateTable('game.ships')
          .set({ laid_up_at: sql<Date>`now()` })
          .where('id', 'in', laidUp)
          .execute();
      if (rearmed.length > 0)
        await trx
          .updateTable('game.ships')
          .set({ laid_up_at: null })
          .where('id', 'in', rearmed)
          .execute();
      // L'impayé est daté par la base, de la transaction qui l'écrit (garde des biens).
      if (lapsed.length > 0)
        await trx
          .updateTable('game.properties')
          .set({ upkeep_unpaid_since: sql<Date>`now()` })
          .where('id', 'in', lapsed)
          .execute();
      if (restored.length > 0)
        await trx
          .updateTable('game.properties')
          .set({ upkeep_unpaid_since: null })
          .where('id', 'in', restored)
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
          ...(ships.length > 0 && {
            ships: {
              upkeepOboles: fleet.total,
              paid: paidShips,
              unpaid: fleet.unpaid,
              laidUp,
              rearmed,
            },
          }),
          ...(estates.length > 0 && {
            properties: {
              upkeepOboles: estate.total,
              paid: paidEstates,
              unpaid: estate.unpaid,
              lapsed,
              restored,
            },
          }),
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
      totals.shipUpkeepOboles += fleet.total;
      totals.shipsPaid += paidShips.length;
      totals.shipsUnpaid += fleet.unpaid.length;
      totals.laidUp += laidUp.length;
      totals.rearmed += rearmed.length;
      totals.propertyUpkeepOboles += estate.total;
      totals.propertiesPaid += paidEstates.length;
      totals.propertiesUnpaid += estate.unpaid.length;
      totals.lapsed += lapsed.length;
      totals.restored += restored.length;
    }
    return totals;
  },
};

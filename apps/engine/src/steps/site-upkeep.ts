import { cityDailyWageOboles, stewardDailyWageOboles } from '@oikos/config';
import { upkeepSettledSchema } from '@oikos/contracts';
import {
  allocateWorkforce,
  holdingUnits,
  settlePropertyUpkeep,
  settleShipUpkeep,
  settleStewardWages,
  settleUpkeep,
  siteDailyDue,
  sumDailyDues,
  type SystemAccountKey,
} from '@oikos/sim';
import { lockNpcPurses, readHousing, type Db } from '@oikos/db';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Puits du dû quotidien des sites (docs/specs/05-economie.md, 5.5), dans l'ordre où ils sont verrouillés :
 * l'entretien, puis les salaires (4.4), puis l'entretien des navires (4.6) et celui des biens immobiliers
 * (4.5), que seule la clôture prélève, puis l'hébergement chez les PNJ (#258). La relance d'un site prend
 * l'entretien, les salaires et l'hébergement, dans le même ordre. Depuis #632, salaires et hébergement vont
 * aux bourses des PNJ : leurs deux puits ne reçoivent plus rien, mais restent verrouillés, à leur place, pour
 * garder l'ordre des verrous (la clôture et la relance prennent les bourses juste après eux).
 */
const SINKS = [
  'sink_upkeep',
  'sink_npc_wages',
  'sink_ship_upkeep',
  'sink_property_upkeep',
  'sink_npc_lodging',
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
  return ids as [string, string, string, string, string];
}

/**
 * Entretien et salaires quotidiens des sites (5.5, 4.4). Chaque site qui existait à l'instant de la
 * clôture doit un jour d'entretien, plus le salaire du jour de sa cité pour chacun des travailleurs de sa
 * recette, à l'arrêt ou non. Par maison, `settleUpkeep` décide de ce que la trésorerie paie, chaque site
 * en entier ou pas du tout ; le tout part aux puits par une seule écriture du grand livre, qui enregistre
 * la décision (maison, jour de jeu, sites payés) et porte une ligne de débit de la trésorerie par nature
 * (`upkeep`, `wages`, 4.1) ; l'entretien va à son puits, les salaires à la bourse des PNJ de la cité de
 * chaque site (#632), une ligne par bourse. Une part nulle n'a pas de ligne. Un site impayé
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
 * Le salaire du jour et le prix de l'hébergement de chaque cité sont ceux que l'étape `laborMarket` vient
 * d'enregistrer (4.4, #258) ; sans eux (étape jouée seule), le salaire de base de la configuration, et
 * aucun hébergement. Les travailleurs d'un site que les logements de sa maison dans sa cité ne logent pas
 * (les sites les plus anciens d'abord) coûtent chacun une nuit d'hébergement, comptée dans le dû du site,
 * payé en entier ou pas du tout ; elle part à la bourse des PNJ de la cité du site (#632) par une écriture
 * `lodging.daily` de la même transaction, de nature 4.1 `lodging`.
 * Ses intendants (4.4, #278) enfin, en poste et embauchés avant l'instant de la clôture, dans l'ordre de leur
 * embauche : chacun doit le salaire d'un jour de la configuration, payé en entier ou pas du tout, par une ligne
 * `wages` de la même écriture, versée à la bourse des PNJ de la cité de son site (#632). Un intendant impayé est
 * inactif jusqu'à la clôture qui le paie ; un salaire nul est payé, et rend actif l'intendant tout juste embauché.
 * Une version sans section `stewards` les tient tous impayés, sans rien prélever.
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
    const [upkeepSink, , shipSink, propertySink] = await lockUpkeepSinks(trx, worldId);
    // Les bourses des PNJ du monde (#632), après les puits et avant toute trésorerie, comme la relance.
    const purses = await lockNpcPurses(trx, worldId);
    const purseOf = (cityId: string) => {
      const purse = purses.get(cityId);
      if (!purse) throw new Error(`City ${cityId} has no NPC purse`);
      return purse.accountId;
    };
    const propertyUpkeepOf = new Map(
      config.properties.sizes.map((size) => [size.id, size.dailyUpkeepOboles]),
    );
    const shipUpkeepOf = new Map(
      config.ships.classes.map((shipClass) => [shipClass.id, shipClass.dailyUpkeepOboles]),
    );
    // Salaire du jour et prix de l'hébergement de chaque cité du monde, fixés par le marché du travail du
    // jour ; à défaut, le salaire de base de la cité (la cité de la configuration porte l'identifiant de son
    // slug), sans hébergement.
    const market = new Map(
      (
        await trx
          .selectFrom('game.labor_market')
          .select(['city_id', 'wage_oboles', 'lodging_oboles'])
          .where('world_id', '=', worldId)
          .where('game_day', '=', gameDay)
          .execute()
      ).map((row) => [
        row.city_id,
        { wage: Number(row.wage_oboles), lodging: Number(row.lodging_oboles) },
      ]),
    );
    const wageOf = new Map(
      (
        await trx
          .selectFrom('game.cities')
          .select(['id', 'slug'])
          .where('world_id', '=', worldId)
          .execute()
      ).map((city) => [
        city.id,
        market.get(city.id)?.wage ?? cityDailyWageOboles(config, city.slug),
      ]),
    );
    const lodgingOf = (cityId: string) => market.get(cityId)?.lodging ?? 0;
    const lodgingDue = [...market.values()].some((day) => day.lodging > 0);
    // Les logements du monde, lus une fois, avant qu'une maison ne marque ou ne lève l'impayé de ses biens
    // : un bien trouvé impayé par cette clôture loge encore ce jour-là, quel que soit l'ordre des maisons,
    // comme l'a compté le marché du travail (4.5). Inutile si nulle part l'hébergement ne coûte rien.
    const holdings = lodgingDue
      ? (await readHousing(trx, { worldId })).map((row) => ({
          houseId: row.houseId,
          cityId: row.cityId,
          units: holdingUnits(row, config.properties.sizes),
        }))
      : [];
    // Les maisons qui avaient un site, un navire ou un bien immobilier à l'instant de la clôture.
    const houses = await trx
      .selectFrom('game.sites')
      .select('house_id')
      .where('world_id', '=', worldId)
      .where('created_at', '<', closeAt)
      .where('closed_at', 'is', null)
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
      lodgingOboles: 0,
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
      stewardWagesOboles: 0,
      stewardsPaid: 0,
      stewardsUnpaid: 0,
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
        .select(['id', 'house_id', 'recipe_id', 'city_id', 'halted_at'])
        .where('house_id', '=', houseId)
        .where('created_at', '<', closeAt)
        // Un site fermé d'une maison PNJ (#717) ne doit rien, ni ne repart.
        .where('closed_at', 'is', null)
        .orderBy('created_at')
        .orderBy('id')
        .forUpdate()
        .execute();
      // Logement de ses travailleurs : ses logements lus avant la boucle, attribués à ses sites verrouillés.
      const housed = allocateWorkforce(
        sites.map((site) => ({
          siteId: site.id,
          houseId,
          cityId: site.city_id,
          workers: recipeOf.get(site.recipe_id)?.workers ?? 0,
        })),
        holdings.filter((holding) => holding.houseId === houseId),
      );
      const dues = sites.map((site) => {
        const recipe = recipeOf.get(site.recipe_id);
        const { upkeepOboles, wagesOboles, lodgingOboles, oboles } = recipe
          ? siteDailyDue({
              upkeepBaseOboles: dailyOboles[recipe.siteType],
              coefficientBps,
              workers: recipe.workers,
              wageOboles: wageOf.get(site.city_id) ?? 0,
              unhoused: housed.get(site.id)?.unhoused ?? 0,
              lodgingPriceOboles: lodgingOf(site.city_id),
            })
          : { upkeepOboles: 0, wagesOboles: 0, lodgingOboles: 0, oboles: 0 };
        // L'hébergement n'apparaît que s'il coûte : l'écriture et l'événement restent ceux d'avant #258.
        return {
          siteId: site.id,
          oboles,
          upkeepOboles,
          wagesOboles,
          ...(lodgingOboles > 0 && {
            lodgingOboles,
            unhoused: housed.get(site.id)?.unhoused ?? 0,
          }),
        };
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
      // Les intendants enfin, dans l'ordre de leur embauche, avec ce qui reste après tout le reste.
      const stewards = await trx
        .selectFrom('game.stewards')
        .select(['id', 'site_id', 'unpaid_since'])
        .where('house_id', '=', houseId)
        .where('hired_at', '<', closeAt)
        .where('dismissed_at', 'is', null)
        .orderBy('hired_at')
        .orderBy('id')
        .forUpdate()
        .execute();
      // Cité du site de chaque intendant : la bourse qui reçoit son salaire.
      const cityOf = new Map(sites.map((site) => [site.id, site.city_id]));
      const stewardSites = stewards.map((row) => row.site_id).filter((id) => !cityOf.has(id));
      if (stewardSites.length > 0)
        for (const row of await trx
          .selectFrom('game.sites')
          .select(['id', 'city_id'])
          .where('id', 'in', stewardSites)
          .execute())
          cityOf.set(row.id, row.city_id);
      const purseOfSite = (siteId: string) => purseOf(cityOf.get(siteId) ?? '');
      const wage = stewardDailyWageOboles(config);
      const wageDues = stewards.map((row) => ({
        stewardId: row.id,
        siteId: row.site_id,
        oboles: wage,
      }));
      // Une version sans intendants (retour arrière) n'ouvre aucun poste : elle ne paie ni n'active personne.
      const staff = config.stewards
        ? settleStewardWages(
            Number(account.balance) - sitesTotal - fleet.total - estate.total,
            wageDues,
          )
        : { paid: [], unpaid: wageDues, total: 0 };
      const paidStewards = staff.paid.filter((due) => due.oboles > 0);
      const inactive = new Set(stewards.filter((row) => row.unpaid_since).map((row) => row.id));
      const deactivated = staff.unpaid
        .map((due) => due.stewardId)
        .filter((id) => !inactive.has(id));
      const activated = staff.paid.map((due) => due.stewardId).filter((id) => inactive.has(id));
      const total = sitesTotal + fleet.total + estate.total + staff.total;
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
        restored.length +
        staff.unpaid.length +
        activated.length;
      if (total === 0 && touched === 0) continue;

      // L'entretien, les salaires, les navires et les biens dans l'écriture d'entretien ; l'hébergement dans
      // la sienne, de la même transaction.
      if (total - lines.lodgingOboles > 0) {
        const entry = await trx
          .insertInto('game.ledger_entries')
          .values({
            world_id: worldId,
            kind: 'upkeep.daily',
            meta: JSON.stringify({
              houseId,
              gameDay,
              // Le dû de chaque site par nature de cette écriture ; l'hébergement est dans la sienne.
              sites: paid.flatMap(({ siteId, upkeepOboles, wagesOboles }) =>
                upkeepOboles + wagesOboles > 0
                  ? [{ siteId, oboles: upkeepOboles + wagesOboles, upkeepOboles, wagesOboles }]
                  : [],
              ),
              ...(paidShips.length > 0 && { ships: paidShips }),
              ...(paidEstates.length > 0 && { properties: paidEstates }),
              ...(paidStewards.length > 0 && { stewards: paidStewards }),
            }),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        // Débits de la trésorerie par nature, comme avant #632 ; crédits : l'entretien à ses puits, les salaires
        // des sites et des intendants à la bourse de la cité de leur site, une ligne par compte crédité.
        const parts = [
          { nature: 'upkeep', oboles: lines.upkeepOboles },
          { nature: 'wages', oboles: lines.wagesOboles },
          { nature: 'upkeep', oboles: fleet.total },
          { nature: 'upkeep', oboles: estate.total },
          { nature: 'wages', oboles: staff.total },
        ] as const;
        const credits = sumByAccount([
          [upkeepSink, lines.upkeepOboles],
          [shipSink, fleet.total],
          [propertySink, estate.total],
          ...paid.map((due) => [purseOfSite(due.siteId), due.wagesOboles] as const),
          ...paidStewards.map((due) => [purseOfSite(due.siteId), due.oboles] as const),
        ]);
        await trx
          .insertInto('game.ledger_lines')
          .values([
            ...parts
              .filter((part) => part.oboles > 0)
              .map((part) => ({
                entry_id: entry.id,
                account_id: account.id,
                amount: -part.oboles,
                nature: part.nature,
              })),
            ...credits.map(([accountId, oboles]) => ({
              entry_id: entry.id,
              account_id: accountId,
              amount: oboles,
            })),
          ])
          .execute();
      }
      if (lines.lodgingOboles > 0) {
        const entry = await trx
          .insertInto('game.ledger_entries')
          .values({
            world_id: worldId,
            kind: 'lodging.daily',
            meta: JSON.stringify({
              houseId,
              gameDay,
              sites: paid.flatMap((due) =>
                'lodgingOboles' in due
                  ? [{ siteId: due.siteId, unhoused: due.unhoused, oboles: due.lodgingOboles }]
                  : [],
              ),
            }),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const credits = sumByAccount(
          paid.map((due) => [purseOfSite(due.siteId), due.lodgingOboles ?? 0] as const),
        );
        await trx
          .insertInto('game.ledger_lines')
          .values([
            { entry_id: entry.id, account_id: account.id, amount: -lines.lodgingOboles },
            ...credits.map(([accountId, oboles]) => ({
              entry_id: entry.id,
              account_id: accountId,
              amount: oboles,
            })),
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
      // L'impayé est daté par la base, de la transaction qui l'écrit (garde des intendants) ; le payé est levé.
      if (deactivated.length + activated.length > 0)
        await trx
          .updateTable('game.stewards')
          .set({
            unpaid_since: sql<Date | null>`case when id = any(${deactivated}::uuid[]) then now() end`,
          })
          .where('id', 'in', [...deactivated, ...activated])
          .execute();
      const event = upkeepSettledSchema.parse({
        type: 'UpkeepSettled',
        payload: {
          houseId,
          gameDay,
          paidOboles: total,
          upkeepOboles: lines.upkeepOboles,
          wagesOboles: lines.wagesOboles,
          ...(lines.lodgingOboles > 0 && { lodgingOboles: lines.lodgingOboles }),
          paid: paid.map(({ unhoused: _, ...due }) => due),
          unpaid: unpaid.map(({ unhoused: _, ...due }) => due),
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
          ...(stewards.length > 0 && {
            stewards: {
              wagesOboles: staff.total,
              paid: paidStewards,
              unpaid: staff.unpaid,
              deactivated,
              activated,
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
      totals.lodgingOboles += lines.lodgingOboles;
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
      totals.stewardWagesOboles += staff.total;
      totals.stewardsPaid += paidStewards.length;
      totals.stewardsUnpaid += staff.unpaid.length;
    }
    return totals;
  },
};

/** Montants par compte, dans l'ordre de leur première apparition ; un compte au total nul n'a pas de ligne. */
function sumByAccount(amounts: readonly (readonly [string, number])[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const [accountId, oboles] of amounts)
    totals.set(accountId, (totals.get(accountId) ?? 0) + oboles);
  return [...totals].filter(([, oboles]) => oboles > 0);
}

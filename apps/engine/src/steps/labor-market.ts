import { cityDailyWageOboles, type GameConfig } from '@oikos/config';
import { readHousing, type Db } from '@oikos/db';
import {
  allocateWorkforce,
  equilibriumWage,
  holdingUnits,
  laborSupply,
  lodgingPrice,
} from '@oikos/sim';
import type { CloseStep } from '../close';

/**
 * Logement des travailleurs des sites d'un monde, ou d'une maison (4.4, 4.5 ; #258) : chaque site emploie
 * les travailleurs de sa recette (aucun si elle a quitté la configuration), et les biens de sa maison dans
 * sa cité les logent, les plus anciens sites d'abord. `sites` : dans l'ordre de leur création, puis de
 * leur identifiant.
 */
export async function housedWorkforce(
  trx: Db,
  config: Pick<GameConfig, 'recipes' | 'properties'>,
  scope: { worldId: string } | { houseId: string },
  sites: readonly { id: string; house_id: string; city_id: string; recipe_id: string }[],
) {
  const workersOf = new Map(config.recipes.map((recipe) => [recipe.id, recipe.workers]));
  const holdings = (await readHousing(trx, scope)).map((row) => ({
    houseId: row.houseId,
    cityId: row.cityId,
    units: holdingUnits(row, config.properties.sizes),
  }));
  return allocateWorkforce(
    sites.map((site) => ({
      siteId: site.id,
      houseId: site.house_id,
      cityId: site.city_id,
      workers: workersOf.get(site.recipe_id) ?? 0,
    })),
    holdings,
  );
}

/**
 * Marché du travail du jour (docs/specs/04-systemes-gestion.md, 4.4 et 4.5 ; #258), après les loyers (un
 * bail impayé a pris fin et ne loge plus) et la vétusté des biens, juste avant l'entretien qui s'en sert.
 * Pour chaque cité du monde : l'offre de travail (part travailleuse de la population de ses classes, après
 * l'évolution du jour ; sans limite si la configuration ne nomme aucune classe), les travailleurs employés
 * par les sites créés avant l'instant de la clôture et ceux d'entre eux que leur maison ne loge pas, le
 * salaire du jour (`equilibriumWage`) et le prix d'une nuit d'hébergement chez les PNJ (`lodgingPrice`).
 * Une ligne par cité, que la base n'admet qu'une fois par jour de jeu, dans la transaction de la clôture.
 * L'étape ne touche ni monnaie ni bien.
 */
export const laborMarket: CloseStep = {
  name: 'laborMarket',
  async run({ trx, worldId, gameDay, closeAt, config }) {
    const cities = await trx
      .selectFrom('game.cities')
      .select(['id', 'slug'])
      .where('world_id', '=', worldId)
      .orderBy('id')
      .execute();
    const populations = await trx
      .selectFrom('game.npc_population')
      .select(['city_id', 'class_id', 'population'])
      .where('world_id', '=', worldId)
      .execute();
    const sites = await trx
      .selectFrom('game.sites')
      .select(['id', 'house_id', 'city_id', 'recipe_id'])
      .where('world_id', '=', worldId)
      .where('created_at', '<', closeAt)
      // Un site fermé d'une maison PNJ (#717) n'emploie personne.
      .where('closed_at', 'is', null)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    const housed = await housedWorkforce(trx, config, { worldId }, sites);
    const summary = { cities: 0, employed: 0, unhoused: 0, saturated: 0 };
    const rows = cities.map((city) => {
      const employed = sites.filter((site) => site.city_id === city.id);
      const workers = employed.reduce((sum, site) => sum + (housed.get(site.id)?.workers ?? 0), 0);
      const unhoused = employed.reduce(
        (sum, site) => sum + (housed.get(site.id)?.unhoused ?? 0),
        0,
      );
      // Une classe que le moteur n'a pas encore fait naître a la population de la configuration.
      const initial = config.cities.find((candidate) => candidate.id === city.slug)?.population;
      const supply = laborSupply(
        (classId) =>
          populations.find((row) => row.city_id === city.id && row.class_id === classId)
            ?.population ??
          (initial && Object.hasOwn(initial, classId) ? (initial[classId] ?? 0) : 0),
        config.labor.workingShareBps,
      );
      summary.cities += 1;
      summary.employed += workers;
      summary.unhoused += unhoused;
      if (supply !== null && workers > supply) summary.saturated += 1;
      return {
        world_id: worldId,
        city_id: city.id,
        game_day: gameDay,
        supply,
        employed: workers,
        unhoused,
        wage_oboles: equilibriumWage({
          baseOboles: cityDailyWageOboles(config, city.slug),
          employed: workers,
          supply,
          curve: config.labor.wage,
        }),
        lodging_oboles: lodgingPrice({
          baseOboles: config.labor.lodging.baseOboles,
          workers,
          unhoused,
          curve: config.labor.lodging,
        }),
      };
    });
    if (rows.length > 0) await trx.insertInto('game.labor_market').values(rows).execute();
    return summary;
  },
};

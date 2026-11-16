import type { GameConfig } from '@oikos/config';
import type { Db } from '@oikos/db';
import { laborSupply } from '@oikos/sim';
import { sql } from 'kysely';

/**
 * Marché du travail d'une cité (docs/specs/04-systemes-gestion.md, 4.4 ; #258), vu par les commandes qui
 * ajoutent des travailleurs : l'acquisition d'un site, son changement vers une recette qui en demande
 * plus, la fondation d'une maison et son site de départ.
 */

/** La configuration limite-t-elle l'offre de travail ? Sans classe travailleuse, elle est sans limite. */
export const laborIsLimited = (config: Pick<GameConfig, 'labor'>) =>
  Object.keys(config.labor.workingShareBps).length > 0;

/**
 * Met en file les commandes qui ajoutent des travailleurs dans la cité, jusqu'à la fin de la transaction :
 * deux acquisitions simultanées ne prennent pas les mêmes travailleurs. Toujours AVANT la trésorerie et
 * les sites, que la clôture peut tenir : la clôture ne prend jamais ce verrou, et une commande qui
 * l'attendrait en tenant un site pourrait sinon fermer un cycle avec elle. Le verrou de la maison, que
 * `site.acquire` prend avant lui, la clôture ne le prend pas.
 */
export async function lockCityLabor(trx: Db, cityId: string) {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`labor:${cityId}`}, 0))`.execute(trx);
}

/**
 * La cité peut-elle employer `extraWorkers` travailleurs de plus ? Les employés sont ceux de tous les
 * sites de la cité, au nombre de travailleurs de leur recette en vigueur (aucun pour une recette retirée) ;
 * l'offre est la part travailleuse de sa population courante, celle de la configuration pour une classe
 * que le moteur n'a pas encore fait naître. Une population tombée sous l'emploi n'arrête aucun site, mais
 * n'en laisse ouvrir aucun. À appeler sous `lockCityLabor`.
 */
export async function workersAvailable(
  trx: Db,
  config: Pick<GameConfig, 'labor' | 'recipes' | 'cities'>,
  city: { id: string; slug: string },
  extraWorkers: number,
): Promise<boolean> {
  if (extraWorkers <= 0 || !laborIsLimited(config)) return true;
  const workersOf = new Map(config.recipes.map((recipe) => [recipe.id, recipe.workers]));
  const sites = await trx
    .selectFrom('game.sites')
    .select(['recipe_id', (expression) => expression.fn.countAll<string>().as('n')])
    .where('city_id', '=', city.id)
    .groupBy('recipe_id')
    .execute();
  const employed = sites.reduce(
    (sum, row) => sum + (workersOf.get(row.recipe_id) ?? 0) * Number(row.n),
    0,
  );
  const populations = await trx
    .selectFrom('game.npc_population')
    .select(['class_id', 'population'])
    .where('city_id', '=', city.id)
    .execute();
  const initial = config.cities.find((candidate) => candidate.id === city.slug)?.population;
  const supply = laborSupply(
    (classId) =>
      populations.find((row) => row.class_id === classId)?.population ??
      (initial && Object.hasOwn(initial, classId) ? (initial[classId] ?? 0) : 0),
    config.labor.workingShareBps,
  );
  return supply === null || employed + extraWorkers <= supply;
}

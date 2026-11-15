import type { GameConfig } from '@oikos/config';
import type { GoodUsage, NpcClassUsage, RecipeUsage, RetiredUsage } from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';

/** Identifiants qu'une version de configuration connaît : ses biens, ses recettes, ses classes de PNJ. */
export interface ConfigIds {
  goods: readonly string[];
  recipes: readonly string[];
  npcClasses: readonly string[];
}
export const NO_IDS: ConfigIds = { goods: [], recipes: [], npcClasses: [] };

export const configIds = (config: GameConfig): ConfigIds => ({
  goods: config.goods.map((good) => good.id),
  recipes: config.recipes.map((recipe) => recipe.id),
  npcClasses: config.npcClasses.map((npcClass) => npcClass.id),
});

/** Identifiants que toutes les versions données connaissent : ce qu'aucune d'elles ne retire. */
export function commonIds(versions: readonly ConfigIds[]): ConfigIds {
  const [first = NO_IDS, ...rest] = versions;
  const keep = (kind: keyof ConfigIds) =>
    first[kind].filter((id) => rest.every((version) => version[kind].includes(id)));
  return { goods: keep('goods'), recipes: keep('recipes'), npcClasses: keep('npcClasses') };
}

/**
 * Ce que l'état du monde porte encore, tous mondes confondus, des éléments absents de `kept` (#191, #200).
 * La base ne lit que ceux-là : les éléments connus de `kept` ne sont ni lus ni agrégés. Lecture seule.
 * - Bien : stock non nul, ou ordre ouvert d'achat (séquestre) ou de vente (réservation).
 * - Recette : sites qui l'exploitent (à l'arrêt faute de recette une fois retirée : 04, 4.2).
 * - Classe de PNJ : état de population par cité, gardé même à zéro habitant (05, 5.2).
 */
export async function readWorldUsage(db: Db, kept: ConfigIds): Promise<RetiredUsage> {
  const goods = await sql<{
    good_id: string;
    houses: number;
    quantity: string;
    open_orders: number;
    escrow: string;
  }>`
    select good_id, count(distinct house_id)::int as houses, sum(quantity)::text as quantity,
           sum(open_orders)::int as open_orders, sum(escrow)::text as escrow
    from (
      select good_id, house_id, quantity, 0 as open_orders, 0::numeric as escrow
      from game.inventories where quantity > 0 and good_id <> all(${[...kept.goods]}::text[])
      union all
      select good_id, house_id, 0, 1,
             case when side = 'buy' then price::numeric * remaining else 0 end
      from game.orders where status = 'open' and good_id <> all(${[...kept.goods]}::text[])
    ) as held
    group by good_id
    order by good_id`.execute(db);
  const recipes = await sql<{ recipe_id: string; sites: number; houses: number }>`
    select recipe_id, count(*)::int as sites, count(distinct house_id)::int as houses
    from game.sites where recipe_id <> all(${[...kept.recipes]}::text[])
    group by recipe_id
    order by recipe_id`.execute(db);
  const classes = await sql<{ class_id: string; cities: number; population: string }>`
    select class_id, count(*)::int as cities, sum(population)::text as population
    from game.npc_population where class_id <> all(${[...kept.npcClasses]}::text[])
    group by class_id
    order by class_id`.execute(db);
  return {
    goods: goods.rows.map((row): GoodUsage => ({
      goodId: row.good_id,
      houses: row.houses,
      quantity: Number(row.quantity),
      openOrders: row.open_orders,
      escrowOboles: Number(row.escrow),
    })),
    recipes: recipes.rows.map((row): RecipeUsage => ({
      recipeId: row.recipe_id,
      sites: row.sites,
      houses: row.houses,
    })),
    npcClasses: classes.rows.map((row): NpcClassUsage => ({
      classId: row.class_id,
      cities: row.cities,
      population: Number(row.population),
    })),
  };
}

/**
 * Part d'une lecture qu'une version retire : les éléments lus que la version ne connaît pas. Sert à la
 * liste des versions, lue une seule fois pour toutes (`commonIds`) puis répartie version par version.
 */
export function retiredUsage(usage: RetiredUsage, version: ConfigIds): RetiredUsage {
  const absent = (ids: readonly string[]) => {
    const known = new Set(ids);
    return (id: string) => !known.has(id);
  };
  const [good, recipe, npcClass] = [
    absent(version.goods),
    absent(version.recipes),
    absent(version.npcClasses),
  ];
  return {
    goods: usage.goods.filter((entry) => good(entry.goodId)),
    recipes: usage.recipes.filter((entry) => recipe(entry.recipeId)),
    npcClasses: usage.npcClasses.filter((entry) => npcClass(entry.classId)),
  };
}

/**
 * Identifiants de chaque version enregistrée, lus dans son contenu tel qu'il est en base : une version au
 * contenu illisible (hors schéma) n'en a aucun, et retire donc tout ce que le monde porte. Seuls les
 * identifiants écrits comme des chaînes comptent.
 */
export async function versionConfigIds(db: Db): Promise<Map<string, ConfigIds>> {
  const rows = await sql<{ id: string; goods: unknown; recipes: unknown; npc_classes: unknown }>`
    select id,
           jsonb_path_query_array(payload, 'lax $.goods[*].id') as goods,
           jsonb_path_query_array(payload, 'lax $.recipes[*].id') as recipes,
           jsonb_path_query_array(payload, 'lax $.npcClasses[*].id') as npc_classes
    from config.versions`.execute(db);
  const strings = (ids: unknown) =>
    Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  return new Map(
    rows.rows.map((row) => [
      row.id,
      {
        goods: strings(row.goods),
        recipes: strings(row.recipes),
        npcClasses: strings(row.npc_classes),
      },
    ]),
  );
}

import type { GoodUsage, RetiredUsage } from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';

/**
 * Ce que l'état du monde porte encore des éléments de la configuration (#191), tous mondes confondus.
 * Un bien est porté par un stock non nul ou par un ordre ouvert, d'achat (séquestre) ou de vente
 * (réservation). Lecture seule ; #200 y ajoutera les sites qui exploitent une recette et les classes.
 */
export async function readWorldUsage(db: Db): Promise<RetiredUsage> {
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
      from game.inventories where quantity > 0
      union all
      select good_id, house_id, 0, 1,
             case when side = 'buy' then price::numeric * remaining else 0 end
      from game.orders where status = 'open'
    ) as held
    group by good_id
    order by good_id`.execute(db);
  return {
    goods: goods.rows.map((row): GoodUsage => ({
      goodId: row.good_id,
      houses: row.houses,
      quantity: Number(row.quantity),
      openOrders: row.open_orders,
      escrowOboles: Number(row.escrow),
    })),
  };
}

/** Usages de ce qu'une version retire : les éléments que le monde porte et que la version ne connaît pas. */
export function retiredUsage(
  usage: RetiredUsage,
  version: { goods: readonly string[] },
): RetiredUsage {
  const known = new Set(version.goods);
  return { goods: usage.goods.filter((good) => !known.has(good.goodId)) };
}

/**
 * Identifiants des biens de chaque version enregistrée, lus dans son contenu tel qu'il est en base : une
 * version au contenu illisible (hors schéma) n'en a aucun, et retire donc tout ce que le monde porte.
 */
export async function versionGoodIds(db: Db): Promise<Map<string, string[]>> {
  const rows = await sql<{ id: string; goods: unknown }>`
    select id, jsonb_path_query_array(payload, 'lax $.goods[*].id') as goods
    from config.versions`.execute(db);
  return new Map(
    rows.rows.map((row) => [
      row.id,
      Array.isArray(row.goods)
        ? row.goods.filter((id): id is string => typeof id === 'string')
        : [],
    ]),
  );
}

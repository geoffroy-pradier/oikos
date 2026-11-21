import type { LoadedConfig } from '@oikos/config';
import { runNpcHouseRules } from '@oikos/engine';
import { sql } from 'kysely';
import { closeOf, type City, type House } from './city';

/*
 * Maisons PNJ de secours dans le banc (8.3, #717) : la clôture du moteur les fonde, les retire et les dissout, et le
 * moteur mène leurs ventes ; le banc, lui, date leurs sites à l'heure de jeu, les récolte comme ses maisons, et compte
 * leurs flux pour le rapprochement du grand livre. Ce sont des choix du banc, pas de l'équilibrage du jeu.
 */

/** Une maison PNJ du banc : sa cité, sa filière, ses sites ouverts, et le jour où elle n'en a plus eu aucun. */
export interface NpcBenchHouse extends House {
  city: City;
  chainId: string;
  /** Premier jour du banc après la clôture duquel elle n'avait plus de site ouvert. */
  retreatedDay?: number;
  dissolved: boolean;
}

export function newNpcBench() {
  return {
    houses: new Map<string, NpcBenchHouse>(),
    /** Dotations versées à la fondation (`faucet_npc_house_grant`), d'après la filière de la configuration jouée. */
    grant: 0,
    /** Surplus et dissolutions versés au puits `sink_npc_house_surplus`, d'après les résumés des clôtures. */
    sunk: 0,
    operations: { acted: 0, refused: 0, failed: 0 },
  };
}
export type NpcBench = ReturnType<typeof newNpcBench>;

/**
 * Après la clôture du jour `day` : chaque maison PNJ fondée par elle a ses sites ramenés à l'instant de jeu de la clôture
 * (garde levée, comme les sites des maisons du banc), et sa dotation comptée ; les sites ouverts de chaque maison sont
 * relus, un site rouvert repartant d'un cycle neuf à l'instant de jeu de la clôture. `summary` : le résumé de la
 * clôture, d'où viennent le surplus et les dissolutions.
 */
export async function npcAfterClose(
  world: City,
  cities: readonly City[],
  npc: NpcBench,
  day: number,
  summary: Record<string, unknown>,
) {
  const at = closeOf(world, day);
  const oboles = (step: string) =>
    Number((summary[step] as { oboles?: number } | undefined)?.oboles ?? 0);
  npc.sunk += oboles('npcHouseSurplus') + oboles('npcHouseRetreat');
  const { rows } = await sql<{
    house_id: string;
    city_id: string;
    chain_id: string;
    dissolved: boolean;
  }>`select n.house_id, n.city_id, n.chain_id, r.dissolved_at is not null as dissolved
    from game.npc_houses n join game.cities c on c.id = n.city_id
    left join game.npc_house_retreats r on r.house_id = n.house_id
    where n.world_id = ${world.worldId} order by n.founded_at, c.slug, n.chain_id`.execute(
    world.db,
  );
  for (const row of rows) {
    let house = npc.houses.get(row.house_id);
    if (!house) {
      const city = cities.find((candidate) => candidate.cityId === row.city_id);
      if (!city) throw new Error(`NPC house ${row.house_id} in an unknown city`);
      const chain = world.played.npcHouses[city.slug]?.chains.find((c) => c.id === row.chain_id);
      npc.grant += chain?.grantOboles ?? 0;
      await world.owner.transaction().execute(async (trx) => {
        await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
        await sql`update game.sites set created_at = ${at}, cycle_started_at = ${at}
          where house_id = ${row.house_id}`.execute(trx);
        await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
      });
      house = {
        role: { name: `PNJ ${city.slug}/${row.chain_id}`, count: 1, sites: [] },
        user: '',
        houseId: row.house_id,
        sites: [],
        produced: new Map(),
        city,
        chainId: row.chain_id,
        dissolved: false,
      };
      npc.houses.set(row.house_id, house);
    }
    const sites = await world.db
      .selectFrom('game.sites')
      .select(['id', 'recipe_id', 'created_at'])
      .where('house_id', '=', row.house_id)
      .where('closed_at', 'is', null)
      .orderBy('created_at')
      .orderBy('recipe_id')
      .orderBy('id')
      .execute();
    const known = new Map(house.sites.map((site) => [site.id, site]));
    house.sites = sites.map(
      (site) =>
        known.get(site.id) ?? {
          id: site.id,
          recipeId: site.recipe_id,
          createdAt: site.created_at,
          since: at,
        },
    );
    house.dissolved = row.dissolved;
    if (house.sites.length === 0) house.retreatedDay ??= day;
  }
}

/** Ventes des maisons PNJ du monde pour un tick joué, sous la configuration du banc. */
export async function npcAfterTick(city: City, loaded: LoadedConfig, index: number, npc: NpcBench) {
  const run = await runNpcHouseRules(city.db, {
    worldId: city.worldId,
    index,
    configVersionId: loaded.id,
    config: loaded.config,
  });
  for (const key of ['acted', 'refused', 'failed'] as const) npc.operations[key] += run[key];
}

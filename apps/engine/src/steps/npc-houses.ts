import type { NpcChain, NpcHouses } from '@oikos/config';
import { npcHouseFoundedSchema, type Blazon } from '@oikos/contracts';
import { violatedConstraint, type Db } from '@oikos/db';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/** Blason commun des maisons PNJ de secours : du contenu, pas de l'équilibrage ; il les fait reconnaître (8.3). */
export const NPC_HOUSE_BLAZON: Blazon = { shape: 'thyreos', tincture: 'black', emblem: 'amphora' };

/** Clé d'une filière dans une cité : ce que `game.npc_houses` rend unique (`npc_houses_one_per_chain`). */
export const npcChainKey = (cityId: string, chainId: string) => `${cityId} ${chainId}`;

/**
 * Fondations dues, sans entrée-sortie : pour chaque cité du monde, dans l'ordre donné, ses filières de la
 * configuration, dans leur ordre, que ne tient encore aucune maison PNJ (`held`, par `npcChainKey`). Une cité de la
 * configuration absente du monde n'en a aucune ; une cité du monde absente de la configuration non plus.
 */
export function dueNpcHouses(
  npcHouses: NpcHouses,
  cities: readonly { id: string; slug: string }[],
  held: ReadonlySet<string>,
): { cityId: string; chain: NpcChain }[] {
  return cities.flatMap((city) =>
    (Object.hasOwn(npcHouses, city.slug) ? (npcHouses[city.slug]?.chains ?? []) : [])
      .filter((chain) => !held.has(npcChainKey(city.id, chain.id)))
      .map((chain) => ({ cityId: city.id, chain })),
  );
}

/** Filière passée par la clôture, faute d'un nom que la base admet : la Vigie l'annonce (#949). */
export interface NpcChainSkipped {
  cityId: string;
  chainId: string;
  name: string;
  /** `taken` : nom déjà porté dans le monde ; `refused` : nom que la règle de la base (`houses_name_check`) refuse. */
  reason: 'taken' | 'refused';
}

/**
 * Fonde la maison sans compte, dans un point de sauvegarde : un nom déjà porté (`houses_name_unique`) ou refusé par la
 * règle de la base (`houses_name_check`, qui fait foi sur celle de la configuration) ne fait jamais échouer la clôture.
 * Rend la maison fondée, ou la raison du refus.
 */
async function foundHouse(trx: Db, worldId: string, name: string) {
  await sql`savepoint npc_house_name`.execute(trx);
  try {
    const house = await trx
      .insertInto('game.houses')
      .values({
        world_id: worldId,
        user_id: null,
        name,
        blazon: JSON.stringify(NPC_HOUSE_BLAZON),
        kind: 'npc',
      })
      .onConflict((conflict) => conflict.constraint('houses_name_unique').doNothing())
      .returning(['id', 'name'])
      .executeTakeFirst();
    await sql`release savepoint npc_house_name`.execute(trx);
    return house ?? ('taken' as const);
  } catch (error) {
    if (violatedConstraint(error) !== 'houses_name_check') throw error;
    await sql`rollback to savepoint npc_house_name`.execute(trx);
    await sql`release savepoint npc_house_name`.execute(trx);
    return 'refused' as const;
  }
}

/**
 * Maisons PNJ de secours (docs/specs/08-ia.md, 8.3 ; #715). Chaque filière de la configuration (`npcHouses`) qu'aucune
 * maison PNJ ne tient encore dans sa cité reçoit la sienne : une maison sans compte, de nature `npc`, au blason
 * commun, métèque de la cité, qui tient la filière (`npc_houses`), son compte, sa dotation versée par le robinet
 * `faucet_npc_house_grant` (aucune écriture pour une dotation nulle) et ses sites, qui démarrent maintenant : créés
 * après l'instant de la clôture, ils n'emploient ni ne paient rien avant la suivante. Un événement `NpcHouseFounded`.
 * La base garde la filière unique par cité : rejouée, l'étape ne fonde rien de plus, et la clôture d'un jour ne se
 * joue qu'une fois. Un nom déjà porté dans le monde, ou que la base refuse, la fait passer, comptée dans `nameTaken` et
 * nommée dans `skipped` (pour la Vigie, #949), jusqu'à une version de configuration qui le change. L'offre de travail n'est pas contrôlée : une population sous l'emploi n'arrête aucun
 * site (4.4). L'étape ne touche que son robinet et la maison qu'elle fonde, et ne prend aucun verrou d'agora.
 */
export const npcHouses: CloseStep = {
  name: 'npcHouses',
  async run({ trx, worldId, gameDay, config, at }) {
    const summary = { founded: 0, nameTaken: 0, oboles: 0 };
    const skipped: NpcChainSkipped[] = [];
    // `skipped` n'apparaît qu'avec une filière passée : le résumé d'une clôture sans incident ne change pas.
    const done = () => (skipped.length > 0 ? { ...summary, skipped } : summary);
    if (Object.keys(config.npcHouses).length === 0) return summary;
    const cities = await trx
      .selectFrom('game.cities')
      .select(['id', 'slug'])
      .where('world_id', '=', worldId)
      .orderBy('slug')
      .orderBy('id')
      .execute();
    const held = await trx
      .selectFrom('game.npc_houses')
      .select(['city_id', 'chain_id'])
      .where('world_id', '=', worldId)
      .execute();
    const due = dueNpcHouses(
      config.npcHouses,
      cities,
      new Set(held.map((row) => npcChainKey(row.city_id, row.chain_id))),
    );
    if (due.length === 0) return done();
    const faucet = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', worldId)
      .where('system_key', '=', 'faucet_npc_house_grant')
      .executeTakeFirstOrThrow();
    for (const { cityId, chain } of due) {
      at?.(`${cityId}/${chain.id}`);
      const house = await foundHouse(trx, worldId, chain.name);
      if (typeof house === 'string') {
        summary.nameTaken += 1;
        skipped.push({ cityId, chainId: chain.id, name: chain.name, reason: house });
        continue;
      }
      await trx
        .insertInto('game.citizenships')
        .values({ house_id: house.id, city_id: cityId })
        .execute();
      await trx
        .insertInto('game.npc_houses')
        .values({ house_id: house.id, world_id: worldId, city_id: cityId, chain_id: chain.id })
        .execute();
      const account = await trx
        .insertInto('game.accounts')
        .values({ world_id: worldId, kind: 'house', house_id: house.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (chain.grantOboles > 0) {
        const entry = await trx
          .insertInto('game.ledger_entries')
          .values({
            world_id: worldId,
            kind: 'npc_house.grant',
            meta: JSON.stringify({ houseId: house.id, cityId, chainId: chain.id, gameDay }),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('game.ledger_lines')
          .values([
            { entry_id: entry.id, account_id: faucet.id, amount: -chain.grantOboles },
            { entry_id: entry.id, account_id: account.id, amount: chain.grantOboles },
          ])
          .execute();
      }
      const sites = Object.entries(chain.sites).flatMap(([recipeId, count]) =>
        Array.from({ length: count }, () => ({
          world_id: worldId,
          house_id: house.id,
          city_id: cityId,
          recipe_id: recipeId,
        })),
      );
      await trx.insertInto('game.sites').values(sites).execute();
      const event = npcHouseFoundedSchema.parse({
        type: 'NpcHouseFounded',
        payload: {
          houseId: house.id,
          worldId,
          cityId,
          chainId: chain.id,
          name: house.name,
          sites: sites.length,
          grantOboles: chain.grantOboles,
          gameDay,
        },
      });
      await trx
        .insertInto('game.domain_events')
        .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
        .execute();
      summary.founded += 1;
      summary.oboles += chain.grantOboles;
    }
    return done();
  },
};

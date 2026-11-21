import type { NpcChain, NpcHouses } from '@oikos/config';
import { npcHouseFoundedSchema, type Blazon } from '@oikos/contracts';
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

/**
 * Maisons PNJ de secours (docs/specs/08-ia.md, 8.3 ; #715). Chaque filière de la configuration (`npcHouses`) qu'aucune
 * maison PNJ ne tient encore dans sa cité reçoit la sienne : une maison sans compte, de nature `npc`, au blason
 * commun, métèque de la cité, qui tient la filière (`npc_houses`), son compte, sa dotation versée par le robinet
 * `faucet_npc_house_grant` (aucune écriture pour une dotation nulle) et ses sites, qui démarrent maintenant : créés
 * après l'instant de la clôture, ils n'emploient ni ne paient rien avant la suivante. Un événement `NpcHouseFounded`.
 * La base garde la filière unique par cité : rejouée, l'étape ne fonde rien de plus, et la clôture d'un jour ne se
 * joue qu'une fois. Un nom déjà porté dans le monde la fait passer, comptée dans `nameTaken`, jusqu'à une version de
 * configuration qui le change. L'offre de travail n'est pas contrôlée : une population sous l'emploi n'arrête aucun
 * site (4.4). L'étape ne touche que son robinet et la maison qu'elle fonde, et ne prend aucun verrou d'agora.
 */
export const npcHouses: CloseStep = {
  name: 'npcHouses',
  async run({ trx, worldId, gameDay, config, at }) {
    const summary = { founded: 0, nameTaken: 0, oboles: 0 };
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
    if (due.length === 0) return summary;
    const faucet = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', worldId)
      .where('system_key', '=', 'faucet_npc_house_grant')
      .executeTakeFirstOrThrow();
    for (const { cityId, chain } of due) {
      at?.(`${cityId}/${chain.id}`);
      const house = await trx
        .insertInto('game.houses')
        .values({
          world_id: worldId,
          user_id: null,
          name: chain.name,
          blazon: JSON.stringify(NPC_HOUSE_BLAZON),
          kind: 'npc',
        })
        .onConflict((conflict) => conflict.constraint('houses_name_unique').doNothing())
        .returning(['id', 'name'])
        .executeTakeFirst();
      if (!house) {
        summary.nameTaken += 1;
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
    return summary;
  },
};

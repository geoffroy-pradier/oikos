import type { GameConfig, NpcChain } from '@oikos/config';
import {
  npcHouseRetreatedSchema,
  npcHouseReturnedSchema,
  type DomainEvent,
} from '@oikos/contracts';
import { lockNpcPurses, type Db } from '@oikos/db';
import { npcHouseRetreat, type NpcRetreatState, type NpcSales } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';
import { lockUpkeepSinks } from './site-upkeep';

/** Filière d'une maison PNJ dans la configuration : aucune pour une cité ou une filière qu'elle ne nomme plus. */
export function chainOf(config: Readonly<GameConfig>, slug: string, chainId: string) {
  const city = Object.hasOwn(config.npcHouses, slug) ? config.npcHouses[slug] : undefined;
  return city?.chains.find((chain) => chain.id === chainId);
}

/** Un site d'une maison PNJ, tel que le retrait le lit, verrouillé. */
export interface RetreatSite {
  id: string;
  recipe_id: string;
  closed_at: Date | null;
  halted_at: Date | null;
}

/**
 * Site que le retrait ferme : le plus récent des sites ouverts. Site qu'il rouvre : le plus ancien des sites fermés dont
 * la recette a encore une place dans la filière (`chain.sites`). Sans entrée-sortie ; `sites` est dans l'ordre de
 * création. Rend aussi le nombre de sites ouverts et de sites qui se rouvriraient, pour `npcHouseRetreat`.
 */
export function retreatSites(sites: readonly RetreatSite[], chain: Pick<NpcChain, 'sites'>) {
  const open = sites.filter((site) => site.closed_at === null);
  const room = new Map(Object.entries(chain.sites));
  for (const site of open) room.set(site.recipe_id, (room.get(site.recipe_id) ?? 0) - 1);
  const reopenable: RetreatSite[] = [];
  for (const site of sites) {
    if (site.closed_at === null || (room.get(site.recipe_id) ?? 0) <= 0) continue;
    room.set(site.recipe_id, (room.get(site.recipe_id) ?? 0) - 1);
    reopenable.push(site);
  }
  return {
    open: open.length,
    max: open.length + reopenable.length,
    toClose: open.at(-1),
    toReopen: reopenable[0],
  };
}

const record = async (trx: Db, events: readonly DomainEvent[]) => {
  if (events.length > 0)
    await trx
      .insertInto('game.domain_events')
      .values(
        events.map((event) => ({
          command_id: null,
          type: event.type,
          payload: JSON.stringify(event.payload),
        })),
      )
      .execute();
};

/**
 * Retrait des maisons PNJ de secours devant les joueurs (docs/specs/08-ia.md, 8.3 ; 05-economie.md, 5.5 ; #717). Pour
 * chaque maison PNJ non dissoute dont la filière est dans la configuration et nomme son bien (`goodId`) : ses ventes du
 * jour sont les unités de ce bien vendues à l'agora de sa cité depuis la clôture précédente (rang des échanges, lu sous
 * le verrou de l'agora, qui ordonne tout échange), par des maisons de joueurs et en tout ; `npcHouseRetreat` décide
 * d'au plus un site : fermer le plus récent des ouverts (`NpcHouseRetreated`), ou rouvrir le plus ancien des fermés
 * qui a encore sa place dans la filière, sur un cycle neuf (`NpcHouseReturned`). La première clôture d'une maison ne
 * fait que poser sa mémoire.
 * Sans section `npcRetreat` (version d'avant #717), rien ne se retire. Jouée avant le marché du travail et l'entretien :
 * un site fermé ce jour n'emploie ni ne doit rien. La mémoire de chaque maison tient le jour de jeu joué : rejouée,
 * l'étape ne fait rien de plus. Verrous de l'entretien, dans son ordre (agora, puits, bourses des PNJ, puis par maison
 * sa trésorerie et ses sites), comme le surplus.
 */
export const npcHouseRetreatStep: CloseStep = {
  name: 'npcHouseRetreat',
  async run({ trx, worldId, gameDay, config, at }) {
    const summary = { houses: 0, retreated: 0, returned: 0 };
    const settings = config.npcRetreat;
    if (!settings) return summary;
    const houses = (
      await trx
        .selectFrom('game.npc_houses as n')
        .innerJoin('game.cities as c', 'c.id', 'n.city_id')
        .leftJoin('game.npc_house_retreats as r', 'r.house_id', 'n.house_id')
        .select(['n.house_id', 'n.city_id', 'n.chain_id', 'c.slug'])
        .select(['r.game_day', 'r.trade_seq', 'r.sales', 'r.above_days', 'r.dissolved_at'])
        .where('n.world_id', '=', worldId)
        .orderBy('n.founded_at')
        .orderBy('n.house_id')
        .execute()
    ).flatMap((row) => {
      const chain = chainOf(config, row.slug, row.chain_id);
      return row.dissolved_at === null && chain?.goodId !== undefined
        ? [{ ...row, chain, goodId: chain.goodId }]
        : [];
    });
    if (houses.length === 0) return summary;
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    await lockUpkeepSinks(trx, worldId);
    await lockNpcPurses(trx, worldId);
    // Sous le verrou de l'agora : tout échange déjà inscrit est validé, tout échange à venir aura un rang plus grand.
    const { rows } = await sql<{ seq: string }>`
      select coalesce(max(seq), 0) as seq from game.trades`.execute(trx);
    const lastSeq = rows[0]?.seq ?? '0';
    for (const house of houses) {
      at?.(`house ${house.house_id}`);
      if (house.game_day === null || house.trade_seq === null) {
        await trx
          .insertInto('game.npc_house_retreats')
          .values({
            house_id: house.house_id,
            world_id: worldId,
            game_day: gameDay,
            trade_seq: lastSeq,
          })
          .execute();
        continue;
      }
      if (house.game_day >= gameDay) continue;
      summary.houses += 1;
      const sold = await sql<{ player: string; total: string }>`
        select coalesce(sum(t.quantity) filter (where h.kind = 'player'), 0) as player,
          coalesce(sum(t.quantity), 0) as total
        from game.trades t
        join game.orders o on o.id = t.sell_order_id
        join game.houses h on h.id = o.house_id
        where t.world_id = ${worldId} and t.seq > ${house.trade_seq} and t.seq <= ${lastSeq}
          and o.city_id = ${house.city_id} and o.good_id = ${house.goodId}`.execute(trx);
      const today: NpcSales = {
        playerUnits: Number(sold.rows[0]?.player ?? 0),
        totalUnits: Number(sold.rows[0]?.total ?? 0),
      };
      // Sa trésorerie, puis ses sites : l'ordre des verrous de l'entretien.
      await trx
        .selectFrom('game.accounts')
        .select('id')
        .where('house_id', '=', house.house_id)
        .where('kind', '=', 'house')
        .forUpdate()
        .execute();
      const sites = await trx
        .selectFrom('game.sites')
        .select(['id', 'recipe_id', 'closed_at', 'halted_at'])
        .where('house_id', '=', house.house_id)
        .orderBy('created_at')
        .orderBy('id')
        .forUpdate()
        .execute();
      const choice = retreatSites(sites, house.chain);
      const memory: NpcRetreatState = {
        window: (house.sales ?? []).map(([playerUnits, totalUnits]) => ({
          playerUnits,
          totalUnits,
        })),
        aboveDays: house.above_days ?? 0,
      };
      const decided = npcHouseRetreat(settings, memory, today, choice);
      const events: DomainEvent[] = [];
      let open = choice.open;
      const moved = decided.move === 'retreat' ? choice.toClose : choice.toReopen;
      if (decided.move !== 'hold' && moved) {
        const retreating = decided.move === 'retreat';
        await trx
          .updateTable('game.sites')
          .set(
            retreating
              ? { closed_at: sql<Date>`now()` }
              : {
                  closed_at: null,
                  ...(moved.halted_at === null && { cycle_started_at: sql<Date>`now()` }),
                },
          )
          .where('id', '=', moved.id)
          .execute();
        open += retreating ? -1 : 1;
        const payload = {
          houseId: house.house_id,
          worldId,
          cityId: house.city_id,
          chainId: house.chain_id,
          siteId: moved.id,
          shareBps: decided.shareBps,
          openSites: open,
          gameDay,
        };
        events.push(
          retreating
            ? npcHouseRetreatedSchema.parse({ type: 'NpcHouseRetreated', payload })
            : npcHouseReturnedSchema.parse({ type: 'NpcHouseReturned', payload }),
        );
        summary[retreating ? 'retreated' : 'returned'] += 1;
      }
      await trx
        .updateTable('game.npc_house_retreats')
        .set({
          game_day: gameDay,
          trade_seq: lastSeq,
          sales: JSON.stringify(
            decided.state.window.map((day) => [day.playerUnits, day.totalUnits]),
          ),
          above_days: decided.state.aboveDays,
        })
        .where('house_id', '=', house.house_id)
        .execute();
      await record(trx, events);
    }
    return summary;
  },
};

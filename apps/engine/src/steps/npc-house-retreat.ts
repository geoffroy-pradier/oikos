import type { GameConfig, NpcChain } from '@oikos/config';
import {
  domainEventSchema,
  MAX_ORDER_QUANTITY,
  npcHouseDissolvedSchema,
  npcHouseRetreatedSchema,
  npcHouseReturnedSchema,
  type DomainEvent,
} from '@oikos/contracts';
import { lockNpcPurses, violatedConstraint, type Db } from '@oikos/db';
import { cancelLockedOrders, placeOrder } from '@oikos/operations';
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
 * Liquidation d'une maison PNJ sans site ouvert (8.3, #717) : ses achats en attente sont annulés et leur séquestre rendu
 * à sa trésorerie ; chaque stock libre est mis en vente au prix de référence de son bien, par le cœur de l'ordre du
 * joueur (ADR 0009), dans un point de sauvegarde : un refus n'a aucun effet. Rend le nombre de ventes posées.
 */
async function liquidate(
  trx: Db,
  config: Readonly<GameConfig>,
  houseId: string,
  now: Date,
  events: DomainEvent[],
) {
  const buys = await trx
    .selectFrom('game.orders')
    .select(['id', 'world_id', 'house_id', 'city_id', 'good_id', 'side', 'price', 'remaining'])
    .where('house_id', '=', houseId)
    .where('status', '=', 'open')
    .where('side', '=', 'buy')
    .orderBy('id')
    .forUpdate()
    .execute();
  await cancelLockedOrders(
    trx,
    buys,
    (event) => events.push(domainEventSchema.parse(event)),
    () => ({ houseId, cause: 'npc_house.liquidation' }),
  );
  const stocks = await trx
    .selectFrom('game.inventories')
    .select(['city_id', 'good_id', 'quantity', 'reserved'])
    .where('house_id', '=', houseId)
    .where(sql<boolean>`quantity > reserved`)
    .orderBy('city_id')
    .orderBy('good_id')
    .execute();
  let offered = 0;
  for (const stock of stocks) {
    const price = config.goods.find((good) => good.id === stock.good_id)?.referencePriceOboles;
    if (price === undefined) continue;
    const quantity = Math.min(Number(stock.quantity) - Number(stock.reserved), MAX_ORDER_QUANTITY);
    const emitted: DomainEvent[] = [];
    await sql`savepoint npc_house_liquidation`.execute(trx);
    const context = {
      trx,
      emit: (event: DomainEvent) => emitted.push(domainEventSchema.parse(event)),
      config: config as GameConfig,
      now,
    };
    let ok = false;
    try {
      ok = (
        await placeOrder.run(
          context,
          { houseId },
          { cityId: stock.city_id, goodId: stock.good_id, side: 'sell', price, quantity },
        )
      ).ok;
    } catch (error) {
      if (!placeOrder.errorByConstraint?.[violatedConstraint(error) ?? '']) throw error;
    }
    if (!ok) {
      await sql`rollback to savepoint npc_house_liquidation`.execute(trx);
      await sql`release savepoint npc_house_liquidation`.execute(trx);
      continue;
    }
    await sql`release savepoint npc_house_liquidation`.execute(trx);
    events.push(...emitted);
    offered += 1;
  }
  return offered;
}

/**
 * Retrait des maisons PNJ de secours devant les joueurs (docs/specs/08-ia.md, 8.3 ; 05-economie.md, 5.5 ; #717). Pour
 * chaque maison PNJ non dissoute dont la filière est dans la configuration et nomme son bien (`goodId`) : ses ventes du
 * jour sont les unités de ce bien vendues à l'agora de sa cité depuis la clôture précédente (rang des échanges, lu sous
 * le verrou de l'agora, qui ordonne tout échange), par des maisons de joueurs et en tout ; `npcHouseRetreat` décide
 * d'au plus un site : fermer le plus récent des ouverts (`NpcHouseRetreated`), ou rouvrir le plus ancien des fermés
 * qui a encore sa place dans la filière, sur un cycle neuf (`NpcHouseReturned`). La première clôture d'une maison ne
 * fait que poser sa mémoire.
 * Sans site ouvert, la maison se liquide : achats annulés, stock libre en vente au prix de référence ; une fois rien
 * de vendu en attente ni en stock, elle verse sa trésorerie au puits `sink_npc_house_surplus` (écriture
 * `npc_house.dissolution`) et se dissout, définitivement (`NpcHouseDissolved`). La base vérifie qu'il ne lui reste rien.
 * Sans section `npcRetreat` (version d'avant #717), rien ne se retire. Jouée avant le marché du travail et l'entretien :
 * un site fermé ce jour n'emploie ni ne doit rien. La mémoire de chaque maison tient le jour de jeu joué : rejouée, l'étape ne fait rien de
 * plus. Verrous de l'entretien, dans son ordre (agora, puits, bourses des PNJ, puits du surplus, puis par maison sa
 * trésorerie et ses sites), comme le surplus.
 */
export const npcHouseRetreatStep: CloseStep = {
  name: 'npcHouseRetreat',
  async run({ trx, worldId, gameDay, config, at }) {
    const summary = { houses: 0, retreated: 0, returned: 0, offered: 0, dissolved: 0, oboles: 0 };
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
        // Les maisons d'une même clôture par cité et filière, sans dépendre de leur identifiant tiré au hasard ; le
        // retrait de l'une ne touche pas l'agora d'une autre filière.
        .orderBy('n.founded_at')
        .orderBy('c.slug')
        .orderBy('n.chain_id')
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
    const sink = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', worldId)
      .where('system_key', '=', 'sink_npc_house_surplus')
      .forUpdate()
      .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no sink_npc_house_surplus`));
    // Sous le verrou de l'agora : tout échange déjà inscrit est validé, tout échange à venir aura un rang plus grand.
    const { rows } = await sql<{ seq: string; now: Date }>`
      select coalesce(max(seq), 0) as seq, now() as now from game.trades`.execute(trx);
    const lastSeq = rows[0]?.seq ?? '0';
    const now = rows[0]?.now ?? new Date();
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
      const account = await trx
        .selectFrom('game.accounts')
        .select('id')
        .where('house_id', '=', house.house_id)
        .where('kind', '=', 'house')
        .forUpdate()
        .executeTakeFirstOrThrow();
      const sites = await trx
        .selectFrom('game.sites')
        .select(['id', 'recipe_id', 'closed_at', 'halted_at'])
        .where('house_id', '=', house.house_id)
        .orderBy('created_at')
        .orderBy('recipe_id')
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
      let dissolved = false;
      if (open === 0) {
        summary.offered += await liquidate(trx, config, house.house_id, now, events);
        const left = await sql<{ busy: boolean; balance: string; other: string }>`select
            exists (select 1 from game.orders where house_id = ${house.house_id} and status = 'open')
              or exists (select 1 from game.inventories where house_id = ${house.house_id} and quantity <> 0) as busy,
            (select balance from game.accounts where id = ${account.id}) as balance,
            (select count(*) from game.accounts where house_id = ${house.house_id} and id <> ${account.id}
               and balance <> 0) as other`.execute(trx);
        const state = left.rows[0];
        if (state && !state.busy && Number(state.other) === 0) {
          const oboles = Number(state.balance);
          if (oboles > 0) {
            const entry = await trx
              .insertInto('game.ledger_entries')
              .values({
                world_id: worldId,
                kind: 'npc_house.dissolution',
                meta: JSON.stringify({
                  houseId: house.house_id,
                  cityId: house.city_id,
                  chainId: house.chain_id,
                  gameDay,
                }),
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            await trx
              .insertInto('game.ledger_lines')
              .values([
                { entry_id: entry.id, account_id: account.id, amount: -oboles },
                { entry_id: entry.id, account_id: sink.id, amount: oboles },
              ])
              .execute();
          }
          events.push(
            npcHouseDissolvedSchema.parse({
              type: 'NpcHouseDissolved',
              payload: {
                houseId: house.house_id,
                worldId,
                cityId: house.city_id,
                chainId: house.chain_id,
                oboles,
                gameDay,
              },
            }),
          );
          dissolved = true;
          summary.dissolved += 1;
          summary.oboles += oboles;
        }
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
          ...(dissolved && { dissolved_at: sql<Date>`now()` }),
        })
        .where('house_id', '=', house.house_id)
        .execute();
      await record(trx, events);
    }
    return summary;
  },
};

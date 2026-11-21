import { dailyCloseAt, hubrisDelta, medianWealth, type MarketSales } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Jauge d'Hybris (docs/specs/07-dieux-faveur-evenements.md, 7.2 ; #734) : à chaque clôture, la jauge de chaque maison
 * de joueur du monde varie par `hubrisDelta`, une ligne du journal `hubris_ledger` par cause non nulle.
 * Ce qu'est la maison compte au jour de la clôture : la part de ses ventes dans chaque marché (bien et cité) au-delà
 * du seuil, sur les échanges des `marketShareWindowDays` derniers jours jusqu'à l'instant de la clôture, et sa fortune
 * (4.1) au-delà d'un multiple de la fortune médiane des maisons de joueur.
 * Ce qu'elle a fait compte sur la période de la dernière clôture enregistrée : les liturgies prélevées d'office à
 * cette clôture (gain), les oboles offertes, les liturgies accomplies et leur faste de l'avant-dernière clôture à la
 * dernière (baisses) ; puis le déclin.
 * Décision : ces actes comptent avec une clôture de retard. Une offrande ou une liturgie commencée avant l'instant
 * d'une clôture peut être validée après que l'étape l'a lue ; comptée jusqu'à l'instant de la clôture du jour, elle
 * serait perdue. Une clôture plus tard, plus aucune commande de la période n'est en cours : chaque acte compte une
 * fois, même après une clôture manquée, puisque les périodes suivent les clôtures enregistrées.
 * Exception : une clôture jouée sous une version sans section `hubris` n'écrit rien et ne compte pas les actes de sa
 * période, qui restent ignorés. Une maison de joueur absente de `game.house_wealth`, qui rend pourtant chaque maison,
 * compterait comme une fortune nulle dans la médiane.
 * Une maison PNJ de secours n'a pas de jauge, et sa fortune n'entre pas dans la médiane ; ses ventes comptent dans
 * les échanges d'un marché.
 * Rejouée dans la même transaction, l'étape n'écrit rien pour une maison qui a déjà une ligne du jour ; la base
 * n'admet d'ailleurs qu'une ligne par maison, cause et jour, dans la transaction qui enregistre la clôture du jour.
 * Ni monnaie ni bien : elle ne prend ni l'agora ni une trésorerie ; les jauges, que seule la clôture écrit, sont tenues
 * par le verrou de la clôture du monde, que la garde du journal reprend. Placée après la planification des événements
 * du monde, avant la désignation des liturgies et tout ce qui touche la monnaie : comme elle, elle lit la fortune avant
 * les loyers et les prélèvements du jour.
 */
export const hubrisGauge: CloseStep = {
  name: 'hubrisGauge',
  async run({ trx, worldId, gameDay, closeAt, config, at }) {
    const rules = config.hubris;
    const summary = { houses: 0, lines: 0 };
    if (!rules) return summary;
    const from = dailyCloseAt(Math.max(0, gameDay - rules.marketShareWindowDays), config.clock);
    const { rows: sales } = await sql<{ house_id: string; sold: string; total: string }>`
      select o.house_id, sum(t.quantity)::text as sold,
        (sum(sum(t.quantity)) over (partition by o.city_id, o.good_id))::text as total
      from game.trades t
      join game.orders o on o.id = t.sell_order_id
      where t.world_id = ${worldId} and t.created_at >= ${from} and t.created_at < ${closeAt}
      group by o.house_id, o.city_id, o.good_id`.execute(trx);
    const marketsOf = new Map<string, MarketSales[]>();
    for (const row of sales)
      marketsOf.set(row.house_id, [
        ...(marketsOf.get(row.house_id) ?? []),
        { sold: BigInt(row.sold), total: BigInt(row.total) },
      ]);
    // Période des actes : de l'avant-dernière clôture enregistrée (sans borne s'il n'y en a pas) à la dernière ; aucune
    // sans clôture enregistrée.
    const [last, before] = await trx
      .selectFrom('game.daily_closes')
      .select(['game_day', 'close_at'])
      .where('world_id', '=', worldId)
      .where('game_day', '<', gameDay)
      .orderBy('game_day', 'desc')
      .limit(2)
      .execute();
    const [end, start] = [last?.close_at ?? null, before?.close_at ?? null];
    const during = (column: string) =>
      sql`${sql.ref(column)} < ${end}::timestamptz and (${start}::timestamptz is null or ${sql.ref(column)} >= ${start})`;
    // Sans verrou de ligne : seule la clôture écrit les jauges, sous le verrou de la clôture du monde.
    const { rows: houses } = await sql<{
      id: string;
      gauge: string;
      wealth: string | null;
      done: boolean;
      levied: number;
      offered: string;
      performed: number;
      splendor: string;
    }>`select h.id, coalesce(x.gauge, 0)::text as gauge, w.wealth::text as wealth,
        exists (select 1 from game.hubris_ledger d where d.house_id = h.id and d.game_day = ${gameDay}) as done,
        (select count(*)::integer from game.liturgies l
         where l.house_id = h.id and l.status = 'levied' and l.settled_day = ${last?.game_day ?? null}::integer) as levied,
        (select coalesce(sum(f.oboles), 0)::text from game.offerings f where f.house_id = h.id and ${during('f.created_at')}) as offered,
        p.performed, p.splendor
      from game.houses h
      left join game.hubris x on x.house_id = h.id
      left join game.house_wealth(${worldId}) w on w.house_id = h.id
      cross join lateral (select count(*)::integer as performed, coalesce(sum(l.splendor), 0)::text as splendor
        from game.liturgies l where l.house_id = h.id and l.status = 'performed' and ${during('l.settled_at')}) p
      where h.world_id = ${worldId} and h.kind = 'player'
      order by h.id`.execute(trx);
    const median = medianWealth(houses.map((house) => BigInt(house.wealth ?? 0)));

    const lines = houses.flatMap((house) => {
      if (house.done) return [];
      at?.(`house ${house.id}`);
      const changes = hubrisDelta(
        Number(house.gauge),
        {
          markets: marketsOf.get(house.id) ?? [],
          wealth: BigInt(house.wealth ?? 0),
          medianWealth: median,
          leviedLiturgies: house.levied,
          offeredOboles: BigInt(house.offered),
          performedLiturgies: house.performed,
          splendorOboles: BigInt(house.splendor),
        },
        rules,
      );
      if (changes.length > 0) summary.houses += 1;
      return changes.map((change) => ({
        world_id: worldId,
        house_id: house.id,
        amount: change.amount,
        cause: change.cause,
        game_day: gameDay,
      }));
    });
    // Par paquets, dans l'ordre des maisons puis des causes : chaque ligne s'applique à la jauge dans cet ordre.
    for (let chunk = 0; chunk < lines.length; chunk += 1_000)
      await trx
        .insertInto('game.hubris_ledger')
        .values(lines.slice(chunk, chunk + 1_000))
        .execute();
    summary.lines = lines.length;
    return summary;
  },
};

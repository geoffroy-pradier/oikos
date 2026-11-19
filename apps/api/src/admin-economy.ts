import type { GameConfig } from '@oikos/config';
import type { AdminEconomy } from '@oikos/contracts';
import type { Db } from '@oikos/db';
import {
  basketCost,
  costRatioBps,
  dailyCloseAt,
  gameDayAt,
  inflationStatus,
  type Traded,
} from '@oikos/sim';
import { type QueryExecutorProvider, sql } from 'kysely';

const DAY_MS = 86_400_000;
type Balance = { world_id: string; slug: string; kind: string; key: string | null; n: string };
type Candle = { world_id: string; good_id: string; current: boolean; paid: string; units: string };

/**
 * Tableau de bord économique (docs/specs/05-economie.md, 5.5) : masse monétaire, robinets et puits.
 * Lecture seule, dans un seul instantané de la base : la masse, les cumuls et les mouvements par jour
 * se recoupent donc toujours. `windowDays` : nombre de jours de jeu détaillés, jour en cours compris.
 * L'indice des prix suit le panier, la fenêtre et la cible de la configuration (`priceIndex`).
 */
export async function readEconomy(
  db: Db,
  config: Readonly<GameConfig>,
  windowDays: number,
): Promise<AdminEconomy> {
  const { clock, priceIndex } = config;
  const goodIds = priceIndex.basket.map((entry) => entry.goodId);
  const [today, accounts, purses, flows, candles, since, windows] = await db
    .transaction()
    .setIsolationLevel('repeatable read')
    .setAccessMode('read only')
    .execute(async (trx) => {
      // Horloge de la base, celle qui date les écritures : le jour en cours ne dépend pas de celle de l'API.
      const { now } = await trx.selectNoFrom(sql<Date>`now()`.as('now')).executeTakeFirstOrThrow();
      // Jours de jeu de la fenêtre, du plus ancien à celui en cours, puis le lendemain qui la ferme : le
      // premier instant de chacun, tel que le moteur le définit, sans dépendre des fuseaux de la base.
      const today = gameDayAt(now, clock);
      const dayStarts = Array.from({ length: windowDays + 1 }, (_, index) =>
        dailyCloseAt(today - windowDays + 1 + index, clock),
      );
      // Soldes par monde, nature de compte et compte système. Tout monde a ses comptes système dès sa
      // création (migration 13) : aucun monde n'est absent, même sans maison.
      const accounts = await sql<Balance>`
        select w.id as world_id, w.slug, a.kind, a.system_key as key, sum(a.balance)::text as n
        from game.worlds w join game.accounts a on a.world_id = w.id and not a.npc_purse
        group by w.id, a.kind, a.system_key order by w.created_at, w.id, a.system_key`.execute(trx);
      // Bourses des PNJ (#632), que le service ne voit pas dans la table : une nature de la masse à part.
      const purses = await sql<{ world_id: string; n: string }>`
        select world_id, sum(balance)::text as n from game.npc_purses() group by world_id`.execute(
        trx,
      );
      // Lignes des comptes système datées dans la fenêtre, par jour de jeu (1 : le plus ancien). Une
      // écriture datée après le jour en cours ne compte que dans les cumuls.
      const flows = await sql<{ world_id: string; key: string; bucket: number; n: string }>`
        select a.world_id, a.system_key as key, sum(l.amount)::text as n,
               width_bucket(e.created_at, ${dayStarts}::timestamptz[]) as bucket
        from game.accounts a
        join game.ledger_lines l on l.account_id = a.id
        join game.ledger_entries e on e.id = l.entry_id
        where a.kind = 'system' and e.created_at >= ${dayStarts[0]} and e.created_at < ${dayStarts.at(-1)}
        group by a.world_id, a.system_key, bucket having sum(l.amount) <> 0
        order by bucket`.execute(trx);
      // Fenêtres de prix : les `priceIndex.windowDays` × 24 heures qui finissent à l'horloge de la base, et
      // celles d'avant. Un chandelier de la série en cours compte en entier dans la fenêtre où il commence.
      const ago = (windows: number) =>
        new Date(now.getTime() - windows * priceIndex.windowDays * DAY_MS);
      const [previousFrom, currentFrom] = [ago(2), ago(1)];
      const candles = await sql<Candle>`
        select world_id, good_id, period_start >= ${currentFrom} as current,
               sum(turnover)::text as paid, sum(volume)::text as units
        from game.price_candles
        where period_seconds = ${config.priceHistory.candleMinutes * 60} and good_id = any(${goodIds}::text[])
          and period_start >= ${previousFrom} and period_start < ${now}
        group by world_id, good_id, current`.execute(trx);
      const since = await historyStarts(trx, config.priceHistory.candleMinutes * 60, now);
      const windows = { previousFrom, currentFrom, now };
      return [today, accounts, purses, flows, candles, since, windows] as const;
    });
  const listed = config.goods.map((good) => [good.id, BigInt(good.referencePriceOboles)] as const);
  const reference = basketCost(
    priceIndex.basket,
    new Map(listed.map(([id, turnover]) => [id, { turnover, volume: 1n }])),
  );
  /** Indice et inflation d'un monde : coûts exacts du panier sur les deux fenêtres, arrondis à la fin. */
  const indexOf = (worldId: string): AdminEconomy['worlds'][number]['priceIndex'] => {
    const traded = (current: boolean) =>
      new Map<string, Traded>(
        candles.rows
          .filter((candle) => candle.world_id === worldId && candle.current === current)
          .map((c) => [c.good_id, { turnover: BigInt(c.paid), volume: BigInt(c.units) }]),
      );
    const [current, previous] = [traded(true), traded(false)];
    const unpriced = (window: Map<string, Traded>) => goodIds.filter((id) => !window.has(id));
    // Fenêtre partielle : l'historique commence strictement à l'intérieur. Au plus une l'est : si c'est la
    // courante, la précédente est vide. Signalée telle quelle, sans rien estimer.
    const first = since.get(worldId)?.getTime();
    const inside = (from: Date, to: Date) =>
      first !== undefined && first > from.getTime() && first < to.getTime();
    const partialWindow = inside(windows.currentFrom, windows.now)
      ? 'current'
      : inside(windows.previousFrom, windows.currentFrom)
        ? 'previous'
        : null;
    const cost = basketCost(priceIndex.basket, current);
    const before = basketCost(priceIndex.basket, previous);
    // Inflation : rapport exact des deux coûts, pas des deux indices déjà arrondis.
    const ratio = costRatioBps(cost, before);
    const inflationBps = ratio === null ? null : ratio - 10_000;
    return {
      currentBps: costRatioBps(cost, reference),
      previousBps: costRatioBps(before, reference),
      inflationBps,
      status: inflationStatus(inflationBps, priceIndex.inflationTargetBps),
      unpricedGoods: goodIds.filter((id) => !current.has(id) || !previous.has(id)),
      unpricedByWindow: { current: unpriced(current), previous: unpriced(previous) },
      partialWindow,
    };
  };
  // Monnaie créée par un robinet (compte débiteur) ou détruite par un puits (compte créditeur), en net.
  const moved = (key: string, sum: string) =>
    key.startsWith('faucet_') ? 0 - Number(sum) : Number(sum);
  const worlds = new Map<string, AdminEconomy['worlds'][number]>();
  for (const { world_id: worldId, slug, kind, key, n } of accounts.rows) {
    const world = worlds.get(worldId) ?? {
      worldId,
      slug,
      moneySupply: { total: 0, houses: 0, escrow: 0, cityTreasuries: 0, npcPurses: 0, other: 0 },
      systemAccounts: [],
      priceIndex: indexOf(worldId),
    };
    worlds.set(worldId, world);
    if (kind === 'system' && key) {
      world.systemAccounts.push({
        key,
        kind: key.startsWith('faucet_') ? 'faucet' : 'sink',
        total: moved(key, n),
        days: flows.rows
          .filter((flow) => flow.world_id === worldId && flow.key === key)
          .map((flow) => ({
            gameDay: today - windowDays + flow.bucket,
            amount: moved(key, flow.n),
          })),
      });
    } else {
      // Tout compte qui n'est pas un compte système porte de la monnaie en circulation ; une nature
      // de compte inconnue ici est comptée à part (`other`), jamais oubliée.
      const known = { house: 'houses', escrow: 'escrow', treasury: 'cityTreasuries' } as const;
      const part =
        kind === 'house' || kind === 'escrow' || kind === 'treasury' ? known[kind] : 'other';
      world.moneySupply[part] += Number(n);
      world.moneySupply.total += Number(n);
    }
  }
  for (const { world_id: worldId, n } of purses.rows) {
    const world = worlds.get(worldId);
    if (!world) continue;
    world.moneySupply.npcPurses += Number(n);
    world.moneySupply.total += Number(n);
  }
  const { windowDays: priceWindowDays, inflationTargetBps } = priceIndex;
  const basketEmpty = priceIndex.basket.length === 0;
  return {
    windowDays,
    priceWindowDays,
    inflationTargetBps,
    basketEmpty,
    worlds: [...worlds.values()],
  };
}

/**
 * Début de l'historique de la série `seconds` dans chaque monde : le premier chandelier commencé
 * strictement avant `now`, tous biens et cités ; un monde sans chandelier passé est absent. Une fenêtre
 * commencée avant lui n'est mesurée que sur sa fin. Un chandelier par monde, lu au début de l'index
 * `(world_id, period_seconds, period_start)` : la recherche ne parcourt pas la série.
 */
export async function historyStarts(
  db: QueryExecutorProvider,
  seconds: number,
  now: Date,
): Promise<Map<string, Date>> {
  const { rows } = await sql<{ world_id: string; first: Date }>`
    select w.id as world_id, c.first from game.worlds w
    cross join lateral (
      select period_start as first from game.price_candles
      where world_id = w.id and period_seconds = ${seconds} and period_start < ${now}
      order by period_start limit 1
    ) c`.execute(db);
  return new Map(rows.map((row) => [row.world_id, row.first]));
}

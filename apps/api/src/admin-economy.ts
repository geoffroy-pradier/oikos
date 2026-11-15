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
import { sql } from 'kysely';

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
  const [today, accounts, flows, candles] = await db
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
        from game.worlds w join game.accounts a on a.world_id = w.id
        group by w.id, a.kind, a.system_key order by w.created_at, w.id, a.system_key`.execute(trx);
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
      const [previousFrom, currentFrom] = [2, 1].map(
        (windows) => new Date(now.getTime() - windows * priceIndex.windowDays * DAY_MS),
      );
      const candles = await sql<Candle>`
        select world_id, good_id, period_start >= ${currentFrom} as current,
               sum(turnover)::text as paid, sum(volume)::text as units
        from game.price_candles
        where period_seconds = ${config.priceHistory.candleMinutes * 60} and good_id = any(${goodIds}::text[])
          and period_start >= ${previousFrom} and period_start < ${now}
        group by world_id, good_id, current`.execute(trx);
      return [today, accounts, flows, candles] as const;
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
      moneySupply: { total: 0, houses: 0, escrow: 0, cityTreasuries: 0, other: 0 },
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
  const { windowDays: priceWindowDays, inflationTargetBps } = priceIndex;
  return { windowDays, priceWindowDays, inflationTargetBps, worlds: [...worlds.values()] };
}

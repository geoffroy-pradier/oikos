import { mkdir, writeFile } from 'node:fs/promises';
import { basketCost, dailyUpkeep, type Traded } from '@oikos/sim';
import { sql } from 'kysely';
import { config, referenceOf } from './city';
import { SLUGS, WORLD_SEED, type Settlement } from './world';

/** Mesures d'un jour de jeu. */
export interface DayMeasure {
  day: number;
  /** Monnaie en circulation, par cité (comptes des maisons qui y sont citoyennes, trésor) ; `world` : tout. */
  supply: Record<string, number>;
  /** Coût du panier de l'indice, par cité, en oboles (arrondi) ; null sans échange du jour. */
  basket: Record<string, number | null>;
  population: Record<string, number>;
  /** Couverture des besoins vitaux en points de base, par cité puis classe. */
  coverage: Record<string, Record<string, number | null>>;
  /** Net de chaque robinet (positif : monnaie créée) et puits (négatif : monnaie détruite), par cité. */
  flows: Record<string, Record<string, number>>;
  /** Échanges du jour par cité et bien, pour les marges. */
  traded: Record<string, Record<string, { turnover: number; volume: number }>>;
}

/** Relève, jour après jour, les mesures des cités d'un monde ; à appeler à la fin de chaque jour de jeu. */
export async function measureDay(
  settlements: readonly Settlement[],
  day: number,
  since: { seq: number; at: Date },
) {
  const [first] = settlements;
  if (!first) throw new Error('No settlement');
  const { db, worldId } = first.city;
  const bySlug = new Map(settlements.map(({ city }) => [city.cityId, city.slug]));
  const measure: DayMeasure = {
    day,
    supply: {},
    basket: {},
    population: {},
    coverage: {},
    flows: {},
    traded: {},
  };
  for (const slug of [...bySlug.values(), 'world']) {
    measure.flows[slug] = {};
    measure.traded[slug] = {};
  }
  // Monnaie : comptes des maisons (et leur séquestre) par cité de citoyenneté, trésor de chaque cité.
  const balances = await sql<{ city_id: string; balance: string }>`
    select coalesce(c.city_id, a.city_id) as city_id, sum(a.balance) as balance
    from game.accounts a left join game.citizenships c on c.house_id = a.house_id
    where a.world_id = ${worldId} and a.kind <> 'system' group by 1`.execute(db);
  measure.supply['world'] = 0;
  for (const row of balances.rows) {
    const slug = bySlug.get(row.city_id) ?? row.city_id;
    measure.supply[slug] = Number(row.balance);
    measure.supply['world'] = (measure.supply['world'] ?? 0) + Number(row.balance);
  }
  // Échanges du jour par cité du marché et bien, depuis le rang de la veille : prix, panier.
  const trades = await sql<{ city_id: string; good_id: string; turnover: string; volume: string }>`
    select o.city_id, o.good_id, sum(t.price * t.quantity) as turnover, sum(t.quantity) as volume
    from game.trades t join game.orders o on o.id = t.sell_order_id
    where t.world_id = ${worldId} and t.seq > ${since.seq} group by 1, 2`.execute(db);
  const tradedBy = new Map<string, Map<string, Traded>>();
  for (const row of trades.rows) {
    const slug = bySlug.get(row.city_id) ?? row.city_id;
    const goods = tradedBy.get(slug) ?? new Map<string, Traded>();
    goods.set(row.good_id, { turnover: BigInt(row.turnover), volume: BigInt(row.volume) });
    tradedBy.set(slug, goods);
    for (const key of [slug, 'world']) {
      const before = measure.traded[key]?.[row.good_id];
      measure.traded[key] = {
        ...measure.traded[key],
        [row.good_id]: {
          turnover: (before?.turnover ?? 0) + Number(row.turnover),
          volume: (before?.volume ?? 0) + Number(row.volume),
        },
      };
    }
  }
  const population = await db
    .selectFrom('game.npc_population')
    .select(['city_id', 'class_id', 'population', 'coverage_bps'])
    .where('world_id', '=', worldId)
    .execute();
  for (const { city } of settlements) {
    const cost = basketCost(config.priceIndex.basket, tradedBy.get(city.slug) ?? new Map());
    measure.basket[city.slug] = cost ? Number(cost[0] / cost[1]) : null;
    const own = population.filter((row) => row.city_id === city.cityId);
    measure.population[city.slug] = own.reduce((sum, row) => sum + row.population, 0);
    measure.coverage[city.slug] = Object.fromEntries(
      own.map((row) => [row.class_id, row.coverage_bps]),
    );
  }
  // Robinets et puits : lignes du grand livre sur les comptes système, écrites depuis la dernière mesure, rangées par cité
  // (marché de l'échange, sinon cité de citoyenneté de la maison, sinon trésor de la cité).
  const flows = await sql<{ city_id: string | null; system_key: string; amount: string }>`
    select coalesce(m.city_id, h.city_id) as city_id, a.system_key, sum(l.amount) as amount
    from game.ledger_entries e
      join game.ledger_lines l on l.entry_id = e.id
      join game.accounts a on a.id = l.account_id and a.kind = 'system'
      left join (select t.ledger_entry_id, o.city_id from game.trades t join game.orders o on o.id = t.sell_order_id) m
        on m.ledger_entry_id = e.id
      left join lateral (
        select coalesce(c.city_id, b.city_id) as city_id
        from game.ledger_lines k join game.accounts b on b.id = k.account_id and b.kind <> 'system'
          left join game.citizenships c on c.house_id = b.house_id
        where k.entry_id = e.id limit 1) h on true
    where e.world_id = ${worldId} and e.created_at > ${since.at} group by 1, 2`.execute(db);
  for (const row of flows.rows) {
    const slug = bySlug.get(row.city_id ?? '') ?? 'unassigned';
    // Un robinet est débité (monnaie créée, net positif), un puits crédité (monnaie détruite, net négatif).
    const net = -Number(row.amount);
    for (const key of [slug, 'world']) {
      measure.flows[key] ??= {};
      measure.flows[key][row.system_key] = (measure.flows[key][row.system_key] ?? 0) + net;
    }
  }
  return measure;
}

/** Prix moyen d'un bien sur des jours mesurés : de la cité, sinon du monde, sinon le prix de référence. */
function averagePrice(days: readonly DayMeasure[], slug: string, goodId: string) {
  const sum = (key: string) =>
    days.reduce(
      (total, day) => {
        const good = day.traded[key]?.[goodId];
        return {
          turnover: total.turnover + (good?.turnover ?? 0),
          volume: total.volume + (good?.volume ?? 0),
        };
      },
      { turnover: 0, volume: 0 },
    );
  for (const key of [slug, 'world']) {
    const { turnover, volume } = sum(key);
    if (volume > 0) return turnover / volume;
  }
  return referenceOf(goodId);
}
/**
 * Marge nette quotidienne d'un site par recette et par cité, en oboles : extrants moins intrants, aux prix
 * moyens de la cité sur `days`, par jour de cycles, moins l'entretien du site et les salaires de ses
 * travailleurs (salaire de la cité de la configuration jouée).
 */
export function recipeMargins(days: readonly DayMeasure[], wages: (slug: string) => number) {
  const margins: Record<string, Record<string, number>> = {};
  for (const slug of SLUGS) {
    const city = config.cities.find((candidate) => candidate.id === slug);
    margins[slug] = {};
    for (const recipe of config.recipes) {
      if (recipe.inputs.length === 0 && !city?.terroir?.includes(recipe.id)) continue;
      const value = (stacks: readonly { goodId: string; quantity: number }[]) =>
        stacks.reduce(
          (sum, stack) => sum + stack.quantity * averagePrice(days, slug, stack.goodId),
          0,
        );
      const perDay =
        (value(recipe.outputs) - value(recipe.inputs)) * (1440 / recipe.durationMinutes);
      const { coefficientBps, dailyOboles } = config.sites.upkeep;
      const upkeep = dailyUpkeep(dailyOboles[recipe.siteType], coefficientBps);
      margins[slug][recipe.id] = Math.round(perDay - upkeep - recipe.workers * wages(slug));
    }
  }
  return margins;
}

/** Puits immobiliers (4.5, 5.5) et publics (6.3), dont le banc mesure la part de la monnaie détruite par les puits. */
export const ESTATE_SINKS = [
  'sink_property_purchase',
  'sink_property_works',
  'sink_property_upkeep',
  'sink_npc_lodging',
] as const;
export const PUBLIC_SINKS = ['sink_public_works', 'sink_festivals'] as const;

/**
 * Part de chaque puits dans la monnaie détruite par tous les puits, en points de base, sur `days`, par cité et
 * pour le monde ; `estate` et `public` : la somme des puits immobiliers et celle des puits publics.
 */
export function sinkShares(days: readonly DayMeasure[]) {
  const shares: Record<string, Record<string, number>> = {};
  for (const slug of [...SLUGS, 'world']) {
    const destroyed = new Map<string, number>();
    for (const day of days)
      for (const [key, net] of Object.entries(day.flows[slug] ?? {}))
        if (net < 0) destroyed.set(key, (destroyed.get(key) ?? 0) - net);
    const total = [...destroyed.values()].reduce((sum, amount) => sum + amount, 0);
    const bps = (keys: readonly string[]) =>
      total === 0
        ? 0
        : Math.round(
            (keys.reduce((sum, key) => sum + (destroyed.get(key) ?? 0), 0) * 10_000) / total,
          );
    shares[slug] = {
      ...Object.fromEntries([...destroyed.keys()].sort().map((key) => [key, bps([key])])),
      estate: bps(ESTATE_SINKS),
      public: bps(PUBLIC_SINKS),
    };
  }
  return shares;
}

/** Mesures publiées : tableaux dans le journal du test, et fichier JSON (`BALANCE_REPORT`) que le job `ci` conserve. */
export async function publish(
  days: readonly DayMeasure[],
  margins: Record<string, Record<string, number>>,
  extra: Record<string, unknown>,
) {
  const slugs = [...SLUGS, 'world'] as const;
  console.table(
    days.map((day) => ({
      day: day.day,
      ...Object.fromEntries(slugs.map((slug) => [`supply ${slug}`, day.supply[slug]])),
      ...Object.fromEntries(SLUGS.map((slug) => [`basket ${slug}`, day.basket[slug]])),
      ...Object.fromEntries(SLUGS.map((slug) => [`pop ${slug}`, day.population[slug]])),
    })),
  );
  for (const slug of slugs) {
    const keys = [...new Set(days.flatMap((day) => Object.keys(day.flows[slug] ?? {})))].sort();
    console.log(`Net par jour, ${slug} (oboles, + créée, − détruite)`);
    console.table(
      days.map((day) => ({
        day: day.day,
        ...Object.fromEntries(keys.map((key) => [key, day.flows[slug]?.[key] ?? 0])),
      })),
    );
  }
  console.log('Couverture des besoins vitaux (bps), dernier jour mesuré');
  console.table(days.at(-1)?.coverage);
  console.log('Marge nette quotidienne par recette (oboles)');
  console.table(margins);
  const shares = sinkShares(days);
  console.log('Part de chaque puits dans la monnaie détruite (points de base, jours mesurés)');
  console.table(shares);
  const path = process.env['BALANCE_REPORT'];
  if (path) {
    await mkdir(path.replace(/[^/]*$/, '') || '.', { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ seed: WORLD_SEED, days, margins, sinkShares: shares, ...extra }, null, 1),
    );
  }
}

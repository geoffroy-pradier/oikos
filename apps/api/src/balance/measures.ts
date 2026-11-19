import { mkdir, writeFile } from 'node:fs/promises';
import { basketCost, costRatioBps, dailyUpkeep, type Traded } from '@oikos/sim';
import { sql } from 'kysely';
import { config, recipeOf, referenceOf, type City, type Role } from './city';
import { SLUGS, WORLD_SEED, type Settlement } from './world';

/** Mesures d'un jour de jeu. */
export interface DayMeasure {
  day: number;
  /** Monnaie en circulation, par cité (maisons qui y sont citoyennes, trésor, bourse des PNJ) ; `world` : tout. */
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
  /** Part de ces échanges achetée par des maisons (un ordre d'achat servi, PNJ exclus) : le prix payé des intrants. */
  bought: Record<string, Record<string, { turnover: number; volume: number }>>;
  /** Marché du travail que la clôture du jour a fixé, par cité : salaire, prix d'une nuit, employés et non logés (4.4). */
  labor: Record<string, { wage: number; lodging: number; employed: number; unhoused: number }>;
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
    bought: {},
    labor: {},
  };
  for (const slug of [...bySlug.values(), 'world']) {
    measure.flows[slug] = {};
    measure.traded[slug] = {};
    measure.bought[slug] = {};
  }
  // Monnaie : comptes des maisons (et leur séquestre) par cité de citoyenneté, trésor de chaque cité.
  const balances = await sql<{ city_id: string; balance: string }>`
    select coalesce(c.city_id, a.city_id) as city_id, sum(a.balance) as balance
    from game.accounts a left join game.citizenships c on c.house_id = a.house_id
    where a.world_id = ${worldId} and a.kind <> 'system' and not a.npc_purse group by 1`.execute(
    db,
  );
  // Bourses des PNJ de chaque cité (#632), que le service lit par la fonction de la base.
  const purses = await sql<{ city_id: string; balance: string }>`select city_id, balance
    from game.npc_purses() where world_id = ${worldId}`.execute(db);
  measure.supply['world'] = 0;
  for (const row of [...balances.rows, ...purses.rows]) {
    const slug = bySlug.get(row.city_id) ?? row.city_id;
    measure.supply[slug] = (measure.supply[slug] ?? 0) + Number(row.balance);
    measure.supply['world'] = (measure.supply['world'] ?? 0) + Number(row.balance);
  }
  // Échanges du jour par cité du marché et bien, depuis le rang de la veille : prix, panier.
  const trades = await sql<{
    city_id: string;
    good_id: string;
    turnover: string;
    volume: string;
    bought_turnover: string;
    bought_volume: string;
  }>`
    select o.city_id, o.good_id, sum(t.price * t.quantity) as turnover, sum(t.quantity) as volume,
      coalesce(sum(t.price * t.quantity) filter (where t.buy_order_id is not null), 0) as bought_turnover,
      coalesce(sum(t.quantity) filter (where t.buy_order_id is not null), 0) as bought_volume
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
      if (Number(row.bought_volume) === 0) continue;
      const paid = measure.bought[key]?.[row.good_id];
      measure.bought[key] = {
        ...measure.bought[key],
        [row.good_id]: {
          turnover: (paid?.turnover ?? 0) + Number(row.bought_turnover),
          volume: (paid?.volume ?? 0) + Number(row.bought_volume),
        },
      };
    }
  }
  // Marché du travail : la ligne que la dernière clôture a écrite pour chaque cité.
  const labor = await sql<{
    city_id: string;
    wage_oboles: string;
    lodging_oboles: string;
    employed: string;
    unhoused: string;
  }>`select distinct on (city_id) city_id, wage_oboles, lodging_oboles, employed, unhoused
    from game.labor_market where world_id = ${worldId} order by city_id, game_day desc`.execute(db);
  // `world` : salaire moyen par employé, prix moyen d'une nuit par non logé, totaux des employés et des non logés.
  const world = { wages: 0, lodging: 0, employed: 0, unhoused: 0 };
  for (const row of labor.rows) {
    const [wage, lodging] = [Number(row.wage_oboles), Number(row.lodging_oboles)];
    const [employed, unhoused] = [Number(row.employed), Number(row.unhoused)];
    measure.labor[bySlug.get(row.city_id) ?? row.city_id] = { wage, lodging, employed, unhoused };
    world.wages += wage * employed;
    world.lodging += lodging * unhoused;
    world.employed += employed;
    world.unhoused += unhoused;
  }
  if (labor.rows.length > 0)
    measure.labor['world'] = {
      wage: world.employed === 0 ? 0 : world.wages / world.employed,
      lodging: world.unhoused === 0 ? 0 : world.lodging / world.unhoused,
      employed: world.employed,
      unhoused: world.unhoused,
    };
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
  // (marché de l'échange, sinon cité de citoyenneté de la maison qui paie, sinon trésor ou bourse des PNJ de la cité :
  // un départ, qui paie aussi le trésor de la cité d'arrivée, est rangé dans la cité de la maison). Les
  // bourses sont lues par `game.npc_purses()`, et jamais dans la table : le classement ne dépend pas du rôle (#632).
  const flows = await sql<{ city_id: string | null; system_key: string; amount: string }>`
    with purses as (select account_id, city_id from game.npc_purses() where world_id = ${worldId})
    select coalesce(m.city_id, h.city_id) as city_id, a.system_key, sum(l.amount) as amount
    from game.ledger_entries e
      join game.ledger_lines l on l.entry_id = e.id
      join game.accounts a on a.id = l.account_id and a.kind = 'system'
      left join (select t.ledger_entry_id, o.city_id from game.trades t join game.orders o on o.id = t.sell_order_id) m
        on m.ledger_entry_id = e.id
      left join lateral (
        select coalesce(c.city_id, b.city_id, p.city_id) as city_id
        from game.ledger_lines k
          left join game.accounts b on b.id = k.account_id and b.kind <> 'system' and not b.npc_purse
          left join purses p on p.account_id = k.account_id
          left join game.citizenships c on c.house_id = b.house_id
        where k.entry_id = e.id and (b.id is not null or p.account_id is not null)
        order by c.city_id is null, k.amount limit 1) h on true
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

/**
 * Hausse du coût du panier de l'indice dans une cité (ou le monde), en points de base, entre les `window` premiers et
 * les `window` derniers jours mesurés : chaque fenêtre au prix moyen de ses échanges, pondéré par les volumes, comme
 * le banc à une cité (#78). Null quand un bien du panier ne s'est pas échangé dans une des deux fenêtres.
 */
export function basketDriftBps(days: readonly DayMeasure[], slug: string, window: number) {
  const level = (part: readonly DayMeasure[]) => {
    const traded = new Map<string, Traded>();
    for (const day of part)
      for (const [goodId, good] of Object.entries(day.traded[slug] ?? {})) {
        const sum = traded.get(goodId) ?? { turnover: 0n, volume: 0n };
        traded.set(goodId, {
          turnover: sum.turnover + BigInt(good.turnover),
          volume: sum.volume + BigInt(good.volume),
        });
      }
    return basketCost(config.priceIndex.basket, traded);
  };
  const ratio = costRatioBps(level(days.slice(-window)), level(days.slice(0, window)));
  return ratio === null ? null : ratio - 10_000;
}

/** Demande de référence d'un jour des PNJ d'une cité, par bien : Q0 × population ÷ 1 000 × ticks d'un jour de 24 heures. */
export async function npcDailyDemand(city: City) {
  const rows = await city.db
    .selectFrom('game.npc_population')
    .select(['class_id', 'population'])
    .where('city_id', '=', city.cityId)
    .execute();
  const ticks = (24 * 60) / city.played.clock.tickMinutes;
  const demand = new Map<string, number>();
  for (const npcClass of city.played.npcClasses) {
    const population =
      rows.find((row) => row.class_id === npcClass.id)?.population ??
      city.played.cities.find((each) => each.id === city.slug)?.population[npcClass.id] ??
      0;
    for (const need of npcClass.basket)
      demand.set(
        need.goodId,
        (demand.get(need.goodId) ?? 0) + (need.quantityPerThousand * population * ticks) / 1000,
      );
  }
  return demand;
}

/** Intrants d'un jour que des maisons consomment sans les produire elles-mêmes dans leur cité, par bien (cycles pleins). */
export function netInputs(roles: readonly Role[]) {
  const net = new Map<string, number>();
  for (const role of roles)
    for (const id of role.sites) {
      const recipe = recipeOf(id);
      const cycles = (role.count * 1440) / recipe.durationMinutes;
      for (const stack of recipe.inputs)
        net.set(stack.goodId, (net.get(stack.goodId) ?? 0) + stack.quantity * cycles);
      for (const stack of recipe.outputs)
        net.set(stack.goodId, (net.get(stack.goodId) ?? 0) - stack.quantity * cycles);
    }
  return new Map([...net].filter(([, quantity]) => quantity > 0));
}

type Sums = Record<string, Record<string, { turnover: number; volume: number }>>;
/** Prix moyen d'un bien sur des jours mesurés, dans `key` (une cité ou `world`) ; null sans échange. */
function averageOf(
  days: readonly DayMeasure[],
  pick: (day: DayMeasure) => Sums,
  key: string,
  goodId: string,
) {
  let [turnover, volume] = [0, 0];
  for (const day of days) {
    const good = pick(day)[key]?.[goodId];
    turnover += good?.turnover ?? 0;
    volume += good?.volume ?? 0;
  }
  return volume > 0 ? turnover / volume : null;
}
/** Prix de vente : le prix moyen des échanges (PNJ compris) de la cité, sinon du monde, sinon le prix de référence. */
const salePrice = (days: readonly DayMeasure[], slug: string, goodId: string) =>
  averageOf(days, (day) => day.traded, slug, goodId) ??
  averageOf(days, (day) => day.traded, 'world', goodId) ??
  referenceOf(goodId);
/**
 * Prix payé d'un intrant : le prix moyen des achats des maisons de la cité, sinon de ses échanges ; à défaut, de même
 * pour le monde, puis le prix de référence.
 */
function paidPrice(days: readonly DayMeasure[], slug: string, goodId: string) {
  for (const key of [slug, 'world']) {
    const price =
      averageOf(days, (day) => day.bought, key, goodId) ??
      averageOf(days, (day) => day.traded, key, goodId);
    if (price !== null) return price;
  }
  return referenceOf(goodId);
}

/** Recettes d'atelier (une recette à intrants, 4.3) ; les autres sont des productions de matières premières (4.2). */
export const isWorkshop = (recipe: { inputs: readonly unknown[] }) => recipe.inputs.length > 0;

/**
 * Salaire et part d'hébergement d'un travailleur dans une cité sur `days`, en oboles par jour : le salaire
 * moyen du marché du travail, et le prix d'une nuit fois la part des employés sans logement (4.4).
 */
export function laborCost(days: readonly DayMeasure[], slug: string) {
  let [wages, lodging, employed, known] = [0, 0, 0, 0];
  for (const day of days) {
    const labor = day.labor[slug];
    if (!labor) continue;
    known += 1;
    wages += labor.wage;
    lodging += labor.lodging * labor.unhoused;
    employed += labor.employed;
  }
  return {
    wage: known === 0 ? 0 : wages / known,
    lodging: employed === 0 ? 0 : lodging / employed,
  };
}

/**
 * Marge nette quotidienne d'un site par recette et par cité, en oboles (#285) : ses ventes (extrants au prix
 * moyen de la cité sur `days`), moins ses intrants au prix payé par les maisons de la cité, par jour de cycles, moins
 * l'entretien du site, les salaires de ses travailleurs et leur part d'hébergement (`laborCost`). Les productions
 * de matières premières ne sont comptées que dans le terroir de la cité, les ateliers partout ; `world` compte toutes
 * les recettes, aux prix et au marché du travail du monde : c'est la marge de la filière que borne le banc.
 */
export function recipeMargins(days: readonly DayMeasure[]) {
  const margins: Record<string, Record<string, number>> = {};
  for (const slug of [...SLUGS, 'world']) {
    const terroir =
      slug === 'world' ? null : config.cities.find((city) => city.id === slug)?.terroir;
    const labor = laborCost(days, slug);
    margins[slug] = {};
    for (const recipe of config.recipes) {
      if (!isWorkshop(recipe) && terroir !== null && !terroir?.includes(recipe.id)) continue;
      const value = (
        stacks: readonly { goodId: string; quantity: number }[],
        price: typeof salePrice,
      ) => stacks.reduce((sum, stack) => sum + stack.quantity * price(days, slug, stack.goodId), 0);
      const perDay =
        (value(recipe.outputs, salePrice) - value(recipe.inputs, paidPrice)) *
        (1440 / recipe.durationMinutes);
      const { coefficientBps, dailyOboles } = config.sites.upkeep;
      const upkeep = dailyUpkeep(dailyOboles[recipe.siteType], coefficientBps);
      margins[slug][recipe.id] = Math.round(
        perDay - upkeep - recipe.workers * (labor.wage + labor.lodging),
      );
    }
  }
  return margins;
}

/** Médiane d'une liste non vide. */
export function median(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) throw new Error('Median of nothing');
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Puits immobiliers (4.5, 5.5) et publics (6.3), dont le banc mesure la part de la monnaie détruite par les puits.
 * L'hébergement n'en est plus un depuis #632 : il va à la bourse des PNJ.
 */
export const ESTATE_SINKS = [
  'sink_property_purchase',
  'sink_property_works',
  'sink_property_upkeep',
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

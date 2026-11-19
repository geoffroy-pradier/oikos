import {
  backdate,
  cash,
  config,
  free,
  harvest,
  recipeOf,
  referenceOf,
  worstLodging,
  type City,
  type House,
  type Reply,
  type Role,
} from './city';

/*
 * Constantes de la stratégie scriptée : des choix du banc, pas de l'équilibrage du jeu, qui reste
 * entièrement dans `packages/config`.
 */
/** Prix d'achat maximal des intrants, en multiple du prix de référence. */
const INPUT_BID = 1.5;
/** Le négociant achète tout bien à ce multiple du prix de référence… */
const TRADER_BID = 0.85;
/** … avec, par bien, au plus ce diviseur de sa trésorerie. */
const TRADER_BUDGET_SHARE = 8;
/** Prix demandé plancher, en multiple du prix de référence : une maison garde son stock plutôt que de le brader. */
const ASK_FLOOR = 0.7;
/** Pas quotidien du prix demandé, à la hausse comme à la baisse (1 %). */
const ASK_STEP = 0.01;
/** Part de la récolte à vendre dans la journée sous laquelle le prix demandé baisse. */
const SOLD_SHARE_PRODUCED = 0.9;
/** Même seuil pour un bien revendu (non produit), en part de ce qui était en vente. */
const SOLD_SHARE_RESOLD = 0.5;
/** Jours d'intrants gardés en stock, hors vente. */
const INPUT_DAYS_KEPT = 2;
/** Jours d'entretien de tous ses sites, et de l'hébergement chez les PNJ de tous leurs travailleurs au pire prix, qu'une maison garde après l'acquisition d'un site. */
const UPKEEP_DAYS_KEPT = 3;
/** Mêmes dépenses, en jours, qu'une maison garde hors séquestre quand elle achète ses intrants. */
const UPKEEP_DAYS_BEFORE_BUYING = 2;

/** Entretien quotidien d'un site, en oboles. */
export const upkeepOf = (recipeId: string) =>
  config.sites.upkeep.dailyOboles[recipeOf(recipeId).siteType] ?? 0;

/**
 * Maisons scriptées : un portefeuille de sites, acquis dans l'ordre dès que la trésorerie couvre le
 * site et `UPKEEP_DAYS_KEPT` jours d'entretien de tous ses sites. Le premier site est le champ de blé
 * de la fondation (un site ne change pas de type). Le négociant ne produit que son champ et revend ce
 * qu'il achète bon marché. Nombres de maisons choisis à la main pour que leur production couvre, à peu
 * près et un peu au-dessus, la demande de référence de la cité (#78) : une communauté plausible de 28
 * maisons, pas une stratégie optimale.
 */
export const ROLES: Role[] = [
  { name: 'meunier', count: 2, sites: ['grow_wheat', 'mill_flour', 'mill_flour', 'mill_flour'] },
  {
    name: 'meunier-boulanger',
    count: 1,
    sites: ['grow_wheat', 'mill_flour', 'mill_flour', 'bake_bread'],
  },
  { name: 'boulanger', count: 3, sites: ['grow_wheat', 'bake_bread', 'bake_bread', 'bake_bread'] },
  {
    name: 'boulanger-presseur',
    count: 1,
    sites: ['grow_wheat', 'bake_bread', 'press_oil', 'grow_olives'],
  },
  {
    name: 'charbonnier',
    count: 1,
    sites: ['grow_wheat', 'burn_charcoal', 'burn_charcoal', 'burn_charcoal'],
  },
  {
    name: 'charbonnier-bûcheron',
    count: 1,
    sites: ['grow_wheat', 'burn_charcoal', 'burn_charcoal', 'fell_wood'],
  },
  { name: 'bûcheron', count: 1, sites: ['grow_wheat', 'fell_wood', 'fell_wood', 'fell_wood'] },
  { name: 'pêcheur', count: 2, sites: ['grow_wheat', 'catch_fish', 'catch_fish', 'catch_fish'] },
  { name: 'saunier', count: 1, sites: ['grow_wheat', 'catch_fish', 'rake_salt', 'rake_salt'] },
  {
    name: 'oléiculteur',
    count: 4,
    sites: ['grow_wheat', 'grow_olives', 'grow_olives', 'press_oil'],
  },
  {
    name: 'vigneron',
    count: 6,
    sites: ['grow_wheat', 'grow_grapes', 'ferment_wine', 'ferment_wine'],
  },
  {
    name: 'caviste',
    count: 1,
    sites: ['grow_wheat', 'ferment_wine', 'ferment_wine', 'ferment_wine'],
  },
  {
    name: 'potier',
    count: 1,
    sites: ['grow_wheat', 'throw_amphorae', 'dig_clay', 'throw_amphorae'],
  },
  { name: 'tisserand', count: 1, sites: ['grow_wheat', 'shear_wool', 'shear_wool', 'weave_cloth'] },
  { name: 'tisserand-caviste', count: 1, sites: ['grow_wheat', 'weave_cloth', 'ferment_wine'] },
  { name: 'négociant', count: 1, sites: ['grow_wheat'], trader: true },
];

/** Maison scriptée qui tient ses prix demandés et ses mises en vente d'un jour à l'autre. */
export interface Seller extends House {
  /** Prix demandé par bien, en oboles (réel : seul l'arrondi part dans l'ordre). */
  asks: Map<string, number>;
  /** Quantités mises en vente la veille, par bien. */
  listed: Map<string, number>;
  /** Biens dont la vente est confiée à l'intendant de la maison (règles `sell`) : la maison ne les met pas en vente. */
  delegated?: ReadonlySet<string>;
  /** Biens gardés en stock, hors vente, pour une rénovation en préparation (`balance/housing.ts`). */
  kept?: ReadonlyMap<string, number>;
}
export const seller = (house: House): Seller => ({ ...house, asks: new Map(), listed: new Map() });

/** Ordres ouverts de la maison, annulés ; rend, par bien, ce qui a été vendu la veille. */
export async function cancelOpen(city: City, house: Seller) {
  const open = await city.db
    .selectFrom('game.orders')
    .select(['id', 'good_id', 'side', 'quantity', 'remaining'])
    .where('house_id', '=', house.houseId)
    .where('status', '=', 'open')
    .orderBy('seq')
    .execute();
  // Vendu la veille, par bien : ce qui a été mis en vente, moins ce qui reste ouvert.
  const listed = new Map(house.listed);
  const sold = new Map(house.listed);
  house.listed.clear();
  for (const order of open) {
    if (order.side === 'sell')
      sold.set(order.good_id, (sold.get(order.good_id) ?? 0) - Number(order.remaining));
    const cancelled = await city.send(house.user, 'market.cancelOrder', { orderId: order.id });
    if (!cancelled.ok) throw new Error(`market.cancelOrder: ${cancelled.error?.code}`);
  }
  return { listed, sold };
}

/**
 * Ordre de `n` unités, s'il y en a ; rend vrai s'il est placé. Seul un achat faute de trésorerie peut
 * être refusé : tout autre refus fait échouer le banc.
 */
export async function place(
  city: City,
  house: House,
  goodId: string,
  side: 'buy' | 'sell',
  price: number,
  n: number,
) {
  if (n <= 0) return false;
  const placed = await city.send(house.user, 'market.placeOrder', {
    cityId: city.cityId,
    goodId,
    side,
    price: Math.max(1, Math.round(price)),
    quantity: n,
  });
  assertAdmitted(placed, side === 'buy', 'market.placeOrder');
  return placed.ok;
}
/** Fait échouer le banc sur un refus, sauf un manque de trésorerie quand il est admis. */
export function assertAdmitted(reply: Reply, shortOfFundsAllowed: boolean, command: string) {
  if (!reply.ok && !(shortOfFundsAllowed && reply.error?.code === 'INSUFFICIENT_FUNDS'))
    throw new Error(`${command}: ${reply.error?.code}`);
}

/**
 * Site suivant du portefeuille, s'il laisse `UPKEEP_DAYS_KEPT` jours d'entretien de tous les sites. Rend le
 * coût, d'après la configuration, du site acquis (0 sans acquisition).
 */
async function acquireNext(city: City, house: Seller, now: Date, lodging: number) {
  const next = house.role.sites[house.sites.length];
  if (next) {
    const type = recipeOf(next).siteType;
    const cost = config.sites.acquisitionCostOboles[type] ?? 0;
    const reserve =
      UPKEEP_DAYS_KEPT *
      [...house.sites.map((site) => site.recipeId), next].reduce(
        (sum, id) => sum + upkeepOf(id) + recipeOf(id).workers * lodging,
        0,
      );
    if ((await cash(city, house.houseId)) >= cost + reserve) {
      const acquired = await city.send(house.user, 'site.acquire', { recipeId: next });
      assertAdmitted(acquired, true, 'site.acquire');
      if (acquired.ok) {
        // Daté par la base de l'instant réel, le site est ramené à son instant de jeu : l'entretien est
        // dû dès la clôture suivante.
        await backdate(city, acquired.data.siteId, now);
        house.sites.push({ id: acquired.data.siteId, recipeId: next, createdAt: now, since: now });
        return cost;
      }
    }
  }
  return 0;
}

/**
 * Matinée d'une maison : récolte, ordres de la veille repris, site suivant, achats, prix ajustés, ventes.
 * Rend le coût, d'après la configuration, du site acquis ce matin (0 sans acquisition).
 */
export async function morning(city: City, house: Seller, now: Date) {
  await harvest(city, house, now);
  const { listed, sold } = await cancelOpen(city, house);
  // Acquisition d'abord : un achat d'intrants mettrait sous séquestre la monnaie du site suivant.
  const lodging = worstLodging(city);
  const acquired = await acquireNext(city, house, now, lodging);
  // Intrants : une journée de production, achetée au plus à `INPUT_BID` fois le prix de référence.
  const needs = new Map<string, number>();
  for (const site of house.sites) {
    const recipe = recipeOf(site.recipeId);
    for (const stack of recipe.inputs)
      needs.set(
        stack.goodId,
        (needs.get(stack.goodId) ?? 0) + stack.quantity * Math.floor(1440 / recipe.durationMinutes),
      );
  }
  // La monnaie sous séquestre ne paie pas l'entretien : une maison en garde `UPKEEP_DAYS_BEFORE_BUYING`
  // jours hors de ses achats.
  const reserve =
    UPKEEP_DAYS_BEFORE_BUYING *
    house.sites.reduce(
      (sum, site) => sum + upkeepOf(site.recipeId) + recipeOf(site.recipeId).workers * lodging,
      0,
    );
  for (const [goodId, need] of needs) {
    const missing = need - (await free(city, house.houseId, goodId));
    const price = Math.max(1, Math.round(referenceOf(goodId) * INPUT_BID));
    const affordable = Math.floor(((await cash(city, house.houseId)) - reserve) / price);
    await place(city, house, goodId, 'buy', price, Math.min(missing, affordable));
  }
  if (house.role.trader)
    // Le négociant achète ce qui se vend sous `TRADER_BID` du prix de référence, dans la limite de sa
    // trésorerie.
    for (const good of config.goods) {
      const budget = Math.floor((await cash(city, house.houseId)) / TRADER_BUDGET_SHARE);
      const price = Math.floor(good.referencePriceOboles * TRADER_BID);
      if (price > 0) await place(city, house, good.id, 'buy', price, Math.floor(budget / price));
    }
  const distressed = (await cash(city, house.houseId)) < reserve;
  // Ventes : tout le stock libre, moins `INPUT_DAYS_KEPT` jours d'intrants, au prix demandé du jour.
  const stocks = await city.db
    .selectFrom('game.inventories')
    .select(['good_id', 'quantity', 'reserved'])
    .where('house_id', '=', house.houseId)
    .orderBy('good_id')
    .execute();
  for (const stock of stocks) {
    if (house.delegated?.has(stock.good_id)) continue;
    const reference = referenceOf(stock.good_id);
    // Prix demandé : un pas de plus quand les ventes de la veille ont couvert sa récolte (le stock ne
    // grossit pas), un pas de moins quand elles n'en ont pas écoulé `SOLD_SHARE_PRODUCED` ; pour un bien
    // revendu, tout ce qui était en vente et `SOLD_SHARE_RESOLD`. Jamais sous `ASK_FLOOR`.
    const previous = house.asks.get(stock.good_id) ?? reference;
    const offered = listed.get(stock.good_id);
    const sales = sold.get(stock.good_id) ?? 0;
    const produced = house.produced.get(stock.good_id) ?? 0;
    const expected =
      produced > 0 ? SOLD_SHARE_PRODUCED * produced : SOLD_SHARE_RESOLD * (offered ?? 0);
    const ask =
      offered === undefined
        ? previous
        : sales >= (produced > 0 ? produced : offered)
          ? previous * (1 + ASK_STEP)
          : sales < expected
            ? previous * (1 - ASK_STEP)
            : previous;
    // À court de trésorerie, une maison vend au plancher pour payer son entretien.
    const price = distressed ? reference * ASK_FLOOR : Math.max(reference * ASK_FLOOR, ask);
    house.asks.set(stock.good_id, price);
    const quantity =
      Number(stock.quantity) -
      Number(stock.reserved) -
      INPUT_DAYS_KEPT * (needs.get(stock.good_id) ?? 0) -
      (house.kept?.get(stock.good_id) ?? 0);
    if (await place(city, house, stock.good_id, 'sell', price, quantity))
      house.listed.set(stock.good_id, quantity);
  }
  return acquired;
}

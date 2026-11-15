import {
  backdate,
  cash,
  config,
  free,
  harvest,
  recipeOf,
  referenceOf,
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
/** Jours d'entretien de tous ses sites qu'une maison garde après l'acquisition d'un site. */
const UPKEEP_DAYS_KEPT = 7;

/** Entretien quotidien d'un site, en oboles. */
const upkeepOf = (recipeId: string) =>
  config.sites.upkeep.dailyOboles[recipeOf(recipeId).siteType] ?? 0;

/**
 * Maisons scriptées : un portefeuille de sites, acquis dans l'ordre dès que la trésorerie couvre le
 * site et `UPKEEP_DAYS_KEPT` jours d'entretien de tous ses sites. Le premier site est le champ de blé
 * de la fondation (un site ne change pas de type). Le négociant ne produit que son champ et revend ce
 * qu'il achète bon marché. Nombres de maisons choisis à la main, en première approche : ils ne couvrent
 * pas la demande de la cité, dont les besoins restent couverts bien en deçà du plein (mesures du banc).
 */
export const ROLES: Role[] = [
  { name: 'meunier', count: 2, sites: ['grow_wheat', 'mill_flour', 'mill_flour', 'mill_flour'] },
  {
    name: 'boulanger',
    count: 4,
    sites: ['grow_wheat', 'burn_charcoal', 'bake_bread', 'bake_bread'],
  },
  { name: 'bûcheron', count: 2, sites: ['grow_wheat', 'fell_wood', 'fell_wood', 'fell_wood'] },
  { name: 'pêcheur', count: 1, sites: ['grow_wheat', 'catch_fish', 'catch_fish', 'catch_fish'] },
  { name: 'saunier', count: 1, sites: ['grow_wheat', 'catch_fish', 'catch_fish', 'rake_salt'] },
  {
    name: 'oléiculteur',
    count: 3,
    sites: ['grow_wheat', 'grow_olives', 'grow_olives', 'press_oil'],
  },
  { name: 'pressoir', count: 1, sites: ['grow_wheat', 'grow_olives', 'press_oil'] },
  {
    name: 'vigneron',
    count: 5,
    sites: ['grow_wheat', 'grow_grapes', 'ferment_wine', 'ferment_wine'],
  },
  { name: 'vigneron modeste', count: 1, sites: ['grow_wheat', 'grow_grapes', 'ferment_wine'] },
  { name: 'potier', count: 1, sites: ['grow_wheat', 'dig_clay', 'throw_amphorae'] },
  { name: 'tisserand', count: 1, sites: ['grow_wheat', 'shear_wool', 'weave_cloth', 'rake_salt'] },
  { name: 'négociant', count: 1, sites: ['grow_wheat'], trader: true },
];

/** Maison scriptée qui tient ses prix demandés et ses mises en vente d'un jour à l'autre. */
export interface Seller extends House {
  /** Prix demandé par bien, en oboles (réel : seul l'arrondi part dans l'ordre). */
  asks: Map<string, number>;
  /** Quantités mises en vente la veille, par bien. */
  listed: Map<string, number>;
}
export const seller = (house: House): Seller => ({ ...house, asks: new Map(), listed: new Map() });

/** Ordres ouverts de la maison, annulés ; rend, par bien, ce qui a été vendu la veille. */
async function cancelOpen(city: City, house: Seller) {
  const open = await city.db
    .selectFrom('game.orders')
    .select(['id', 'good_id', 'side', 'quantity', 'remaining'])
    .where('house_id', '=', house.houseId)
    .where('status', '=', 'open')
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
async function place(
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
function assertAdmitted(reply: Reply, shortOfFundsAllowed: boolean, command: string) {
  if (!reply.ok && !(shortOfFundsAllowed && reply.error?.code === 'INSUFFICIENT_FUNDS'))
    throw new Error(`${command}: ${reply.error?.code}`);
}

/**
 * Matinée d'une maison : récolte, ordres de la veille repris, prix ajustés, achats, ventes, sites. Rend
 * le coût, d'après la configuration, du site acquis ce matin (0 sans acquisition).
 */
export async function morning(city: City, house: Seller, now: Date) {
  await harvest(city, house, now);
  const { listed, sold } = await cancelOpen(city, house);
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
  for (const [goodId, need] of needs) {
    const missing = need - (await free(city, house.houseId, goodId));
    await place(city, house, goodId, 'buy', referenceOf(goodId) * INPUT_BID, missing);
  }
  if (house.role.trader)
    // Le négociant achète ce qui se vend sous `TRADER_BID` du prix de référence, dans la limite de sa
    // trésorerie.
    for (const good of config.goods) {
      const budget = Math.floor((await cash(city, house.houseId)) / TRADER_BUDGET_SHARE);
      const price = Math.floor(good.referencePriceOboles * TRADER_BID);
      if (price > 0) await place(city, house, good.id, 'buy', price, Math.floor(budget / price));
    }
  // Ventes : tout le stock libre, moins `INPUT_DAYS_KEPT` jours d'intrants, au prix demandé du jour.
  const stocks = await city.db
    .selectFrom('game.inventories')
    .select(['good_id', 'quantity', 'reserved'])
    .where('house_id', '=', house.houseId)
    .execute();
  for (const stock of stocks) {
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
    const price = Math.max(reference * ASK_FLOOR, ask);
    house.asks.set(stock.good_id, price);
    const quantity =
      Number(stock.quantity) -
      Number(stock.reserved) -
      INPUT_DAYS_KEPT * (needs.get(stock.good_id) ?? 0);
    if (await place(city, house, stock.good_id, 'sell', price, quantity))
      house.listed.set(stock.good_id, quantity);
  }
  // Site suivant du portefeuille, s'il laisse `UPKEEP_DAYS_KEPT` jours d'entretien de tous les sites.
  const next = house.role.sites[house.sites.length];
  if (next) {
    const type = recipeOf(next).siteType;
    const cost = config.sites.acquisitionCostOboles[type] ?? 0;
    const reserve =
      UPKEEP_DAYS_KEPT *
      [...house.sites.map((site) => site.recipeId), next].reduce(
        (sum, id) => sum + upkeepOf(id),
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

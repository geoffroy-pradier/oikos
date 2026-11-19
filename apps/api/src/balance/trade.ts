import {
  cityPortDuesCoefficientBps,
  portDuesBaseOboles,
  routeProvisionsOboles,
  shipRoute,
} from '@oikos/config';
import { cargoUnits, departureCost, type CargoLine } from '@oikos/sim';
import { sql } from 'kysely';
import { cash, config, harvest, referenceOf, type City } from './city';
import { assertAdmitted, cancelOpen, place, type Seller } from './strategy';

/*
 * Négociants du banc des quatre cités (#281) : ils achètent dans une cité ce qui s'y vend moins cher que dans
 * une autre, le transportent par mer (`voyage.depart`, arrivée jouée par l'étape `voyageArrivals` du moteur) et le
 * revendent. Comme le reste de la stratégie scriptée, ce sont des choix du banc, pas de l'équilibrage du jeu.
 */
/** Classe du navire de chaque négociant. */
const SHIP_CLASS = 'coaster';
/** Écart de prix minimal, en points de base du prix d'achat, pour transporter un bien. */
const MIN_MARGIN_BPS = 2_000;
/** Prix d'achat offert, en points de base du prix observé. */
const BUY_PREMIUM_BPS = 500;
/** Prix de vente demandé, en points de base du prix observé. */
const SELL_DISCOUNT_BPS = 300;
/** Prix présumé d'un bien que personne n'a échangé dans une cité, en points de base de son prix de référence. */
const UNSERVED_PRICE_BPS = 13_000;
/** Plancher du prix de vente, en multiple du prix de référence. */
const ASK_FLOOR = 0.7;
/** Un négociant part quand sa cargaison remplit cette part du navire (en dénominateur), ou après cette attente. */
const LOAD_SHARE = 2;
const MAX_WAIT_DAYS = 3;
/** Part de sa trésorerie (diviseur) qu'il engage dans l'achat d'un bien. */
const BUDGET_SHARE = 8;

/** Négociant : une maison scriptée dont la cité est son port d'attache, et son navire une fois acheté. */
export interface Trader extends Seller {
  home: City;
  shipId?: string;
  waitedDays: number;
}
/** Dernier prix moyen observé, par cité (identifiant de configuration) et par bien. */
export type Prices = Map<string, Map<string, number>>;
const priceOf = (prices: Prices, slug: string, goodId: string) =>
  prices.get(slug)?.get(goodId) ?? (referenceOf(goodId) * UNSERVED_PRICE_BPS) / 10_000;

/** Départ d'un voyage : daté de l'instant de jeu (la base date de l'instant réel), arrivée à la même durée. */
export async function backdateVoyage(city: City, voyageId: string, at: Date) {
  await city.owner.transaction().execute(async (trx) => {
    await sql`alter table game.voyages disable trigger voyages_guard, disable trigger voyages_settled`.execute(
      trx,
    );
    await sql`update game.voyages set departed_at = ${at},
      arrives_at = ${at}::timestamptz + (arrives_at - departed_at) where id = ${voyageId}`.execute(
      trx,
    );
    await sql`alter table game.voyages enable trigger voyages_guard, enable trigger voyages_settled`.execute(
      trx,
    );
  });
}

/**
 * Matinée d'un négociant : navire acheté au premier jour, récolte de son champ, ordres de la veille repris, ventes
 * au prix observé de ce qui ne part pas, puis, navire à quai, départ avec la cargaison qui a le meilleur écart de
 * prix, ou achats de ce qui s'écoule mieux ailleurs. Rend le prix du navire acheté ce matin (0 sinon).
 */
export async function traderMorning(
  cities: readonly City[],
  trader: Trader,
  now: Date,
  prices: Prices,
) {
  const { home } = trader;
  const shipClass = config.ships.classes.find((candidate) => candidate.id === SHIP_CLASS);
  if (!shipClass) throw new Error(`Unknown ship class ${SHIP_CLASS}`);
  // Les tarifs de route (provisions, droits de port) et l'entretien des navires sont nuls dans la configuration
  // initiale : le banc ne les compte pas, et refuse de jouer sans eux plutôt que de mal rapprocher le grand livre.
  if (shipClass.dailyUpkeepOboles > 0) throw new Error('Ship upkeep is not counted by the bench');
  let bought = 0;
  if (!trader.shipId && (await cash(home, trader.houseId)) >= shipClass.purchaseCostOboles) {
    const acquired = await home.send(trader.user, 'ship.acquire', {
      classId: SHIP_CLASS,
      expectedCostOboles: shipClass.purchaseCostOboles,
    });
    assertAdmitted(acquired, true, 'ship.acquire');
    if (acquired.ok) [trader.shipId, bought] = [acquired.data.shipId, shipClass.purchaseCostOboles];
  }
  await harvest(home, trader, now);
  await cancelOpen(home, trader);
  const docked = trader.shipId
    ? (
        await home.db
          .selectFrom('game.ships')
          .select('docked_city_id')
          .where('id', '=', trader.shipId)
          .executeTakeFirstOrThrow()
      ).docked_city_id
    : null;
  const here = cities.find((city) => city.cityId === docked);

  // Écart de prix d'un bien d'ici vers chaque cité reliée, en oboles, quand il vaut le transport.
  const spreads = (goodId: string) =>
    cities.flatMap((to) => {
      if (!here || to === here || !shipRoute(config, here.slug, to.slug)) return [];
      const [buy, sell] = [priceOf(prices, here.slug, goodId), priceOf(prices, to.slug, goodId)];
      return (sell - buy) * 10_000 >= MIN_MARGIN_BPS * buy ? [{ to, spread: sell - buy }] : [];
    });
  const gain = (goodId: string, to: City) =>
    spreads(goodId).find((entry) => entry.to === to)?.spread ?? 0;
  const stocks = await home.db
    .selectFrom('game.inventories')
    .select(['city_id', 'good_id', 'quantity', 'reserved'])
    .where('house_id', '=', trader.houseId)
    .execute();
  // Les ordres se placent dans un ordre qui ne dépend ni de la base (ordre physique des lignes) ni des identifiants,
  // tirés à chaque monde : par rang de cité, puis par bien. Le rang des ordres fixe leur priorité à l'agora.
  const rankOf = (cityId: string) => cities.findIndex((candidate) => candidate.cityId === cityId);
  stocks.sort((a, b) => rankOf(a.city_id) - rankOf(b.city_id) || (a.good_id < b.good_id ? -1 : 1));
  // Ventes : tout ce qui n'attend pas, à quai ici, d'être transporté.
  const cargoGoods = new Map<string, number>();
  for (const stock of stocks) {
    const city = cities.find((candidate) => candidate.cityId === stock.city_id);
    const free = Number(stock.quantity) - Number(stock.reserved);
    if (!city || free <= 0) continue;
    if (city === here && spreads(stock.good_id).length > 0) cargoGoods.set(stock.good_id, free);
    else {
      const price = Math.max(
        referenceOf(stock.good_id) * ASK_FLOOR,
        (priceOf(prices, city.slug, stock.good_id) * (10_000 - SELL_DISCOUNT_BPS)) / 10_000,
      );
      await place(city, trader, stock.good_id, 'sell', price, free);
    }
  }
  if (!here) return bought;

  // Meilleure destination : la somme des écarts des biens en stock, ou en vue d'achat.
  const goods = config.goods.map((good) => good.id);
  const score = (to: City, withStock: boolean) =>
    goods.reduce(
      (sum, goodId) =>
        sum +
        (spreads(goodId).find((entry) => entry.to === to)?.spread ?? 0) *
          (withStock ? (cargoGoods.get(goodId) ?? 0) : 1),
      0,
    );
  const best = (withStock: boolean) =>
    cities.filter((to) => to !== here).sort((a, b) => score(b, withStock) - score(a, withStock))[0];
  const destination = best(true);
  const cargo: CargoLine[] = [];
  if (destination && score(destination, true) > 0) {
    for (const goodId of [...cargoGoods.keys()]
      .filter((id) => spreads(id).some((entry) => entry.to === destination))
      .sort((a, b) => gain(b, destination) - gain(a, destination))) {
      const room = shipClass.capacityUnits - cargoUnits(cargo);
      const quantity = Math.min(cargoGoods.get(goodId) ?? 0, room);
      if (quantity > 0) cargo.push({ goodId, quantity });
    }
  }
  trader.waitedDays += 1;
  const full = cargoUnits(cargo) * LOAD_SHARE >= shipClass.capacityUnits;
  if (destination && cargo.length > 0 && (full || trader.waitedDays > MAX_WAIT_DAYS)) {
    const route = shipRoute(config, here.slug, destination.slug);
    if (!route) throw new Error(`No route ${here.slug} ${destination.slug}`);
    const cost = departureCost({
      provisionsOboles: routeProvisionsOboles(route, SHIP_CLASS),
      portDuesBaseOboles: portDuesBaseOboles(config, SHIP_CLASS),
      cityCoefficientBps: cityPortDuesCoefficientBps(config, destination.slug),
      burnShareBps: config.ships.portDues.burnShareBps,
    });
    if (cost.totalOboles > 0) throw new Error('Voyage costs are not counted by the bench');
    const departed = await home.send(trader.user, 'voyage.depart', {
      shipId: trader.shipId,
      fromCityId: here.cityId,
      toCityId: destination.cityId,
      cargo,
      expectedCostOboles: cost.totalOboles,
    });
    assertAdmitted(departed, false, 'voyage.depart');
    await backdateVoyage(home, departed.data.voyageId, now);
    trader.waitedDays = 0;
    return bought;
  }
  // Achats : ce qui vaut le transport vers la meilleure destination, offert un peu au-dessus du prix observé.
  const target = best(false);
  const wanted = goods.filter(
    (goodId) => target && spreads(goodId).some((entry) => entry.to === target),
  );
  for (const goodId of wanted) {
    const price = Math.round(
      (priceOf(prices, here.slug, goodId) * (10_000 + BUY_PREMIUM_BPS)) / 10_000,
    );
    const budget = Math.floor((await cash(home, trader.houseId)) / BUDGET_SHARE);
    const quantity = Math.min(
      Math.floor(budget / price),
      Math.floor(shipClass.capacityUnits / wanted.length),
    );
    await place(here, trader, goodId, 'buy', price, quantity);
  }
  return bought;
}

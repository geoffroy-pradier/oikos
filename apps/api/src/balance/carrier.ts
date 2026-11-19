import {
  cityPortDuesCoefficientBps,
  portDuesBaseOboles,
  routeProvisionsOboles,
  shipRoute,
} from '@oikos/config';
import { cargoUnits, departureCost, type CargoLine } from '@oikos/sim';
import { sql } from 'kysely';
import {
  cash,
  config,
  free,
  harvest,
  recipeOf,
  referenceOf,
  wageOf,
  worstLodging,
  type City,
} from './city';
import { assertAdmitted, place, upkeepOf, type Seller } from './strategy';
import { stewardPrice } from './steward';

/*
 * Armateurs du banc des quatre cités (#283) : une maison qui arme un caboteur et fait la navette entre sa cité
 * d'attache et une cité source. Elle affiche ses prix (`postedPrice`) : à chaque bout, elle remet en vente ce qu'elle y
 * a apporté, et achète au plus à son prix ce qui manque à l'autre bout, sa part de `TARGET_DAYS` jours de la demande de
 * la cité (ses PNJ et les intrants de ses maisons) moins ce qu'elle y a déjà. Elle part quand ces achats sont faits, que
 * la soute est à moitié pleine, ou qu'elle a assez attendu. Elle agit au matin et après chaque tick (d'une heure) où
 * son navire est à quai : un caboteur fait ainsi plusieurs trajets par jour. Ce sont des choix du banc, pas de
 * l'équilibrage du jeu.
 */
/** Classe du navire de chaque armateur. */
const SHIP_CLASS = 'coaster';
/** Stock visé à chaque bout, en jours de la demande de la cité (part de l'armateur). */
const TARGET_DAYS = 2;
/**
 * Prix de vente affiché, en multiple de la référence, des biens qui ne se vendent pas à leur référence. Le vin, rare
 * hors de Kallistè, se vend 52 oboles : le budget d'un tick des PNJ d'une cité à sa population de départ en paie un
 * (54 oboles, `npcGoodBudget`), et à 54 Ampélos et Halos, un peu moins peuplées en début de partie, n'en achèteraient
 * aucun.
 */
const ASK_MULTIPLE: Readonly<Record<string, number>> = { wine: 1.45 };

/**
 * Prix affiché d'un bien par l'armateur. À la vente : sa référence, que les PNJ achètent alors à hauteur de leur
 * besoin, sauf `ASK_MULTIPLE`. À l'achat, au plus sa référence : l'armateur ne fait jamais monter un prix au-dessus,
 * et gagne l'écart des prix demandés plus bas ; il perd la taxe de marché sur ce qu'il paie à la référence.
 */
const postedPrice = (goodId: string, side: 'buy' | 'sell') =>
  Math.round(referenceOf(goodId) * (side === 'sell' ? (ASK_MULTIPLE[goodId] ?? 1) : 1));
/** Le navire part quand sa cargaison remplit cette part de la soute (en dénominateur), ou après cette attente, en heures. */
const LOAD_SHARE = 2;
const MAX_WAIT_HOURS = 6;
/** Jours de dépenses de son site (entretien, salaires) que l'armateur garde hors de ses achats. */
const RESERVE_DAYS = 2;

/** Demande d'un jour d'une cité, par bien : celle de ses PNJ et les intrants nets de ses maisons. */
export type Demand = (city: City) => Promise<Map<string, number>>;

/** Armateur : ses deux ports, ce qu'il porte vers chacun, et la part qui lui revient de la demande de chaque bien. */
export interface Carrier extends Seller {
  home: City;
  source: City;
  /** Biens portés vers chaque port, par identifiant de cité, avec la part de leur demande qui revient à l'armateur. */
  deliver: Map<string, Map<string, number>>;
  shipId?: string;
  waitedHours: number;
}

const shipClassOf = () => {
  const shipClass = config.ships.classes.find((candidate) => candidate.id === SHIP_CLASS);
  if (!shipClass) throw new Error(`Unknown ship class ${SHIP_CLASS}`);
  // L'entretien des navires n'est pas compté par le banc : il refuse de jouer avec plutôt que de mal rapprocher.
  if (shipClass.dailyUpkeepOboles > 0) throw new Error('Ship upkeep is not counted by the bench');
  return shipClass;
};
/** Ordres ouverts de l'armateur dans une cité, annulés (d'un côté seulement si `side` est donné). */
async function cancelIn(city: City, carrier: Carrier, side?: 'buy' | 'sell') {
  const open = await city.db
    .selectFrom('game.orders')
    .select('id')
    .where('house_id', '=', carrier.houseId)
    .where('city_id', '=', city.cityId)
    .where('status', '=', 'open')
    .where('side', 'in', side ? [side] : ['buy', 'sell'])
    .orderBy('seq')
    .execute();
  for (const order of open) {
    const cancelled = await city.send(carrier.user, 'market.cancelOrder', { orderId: order.id });
    if (!cancelled.ok) throw new Error(`market.cancelOrder: ${cancelled.error?.code}`);
  }
}

/** Stock de l'armateur dans une cité, par bien : libre, ou tout entier (`held`), ce qu'il a en vente compris. */
async function stocksIn(city: City, carrier: Carrier, held = false) {
  const rows = await city.db
    .selectFrom('game.inventories')
    .select(['good_id', 'quantity', 'reserved'])
    .where('house_id', '=', carrier.houseId)
    .where('city_id', '=', city.cityId)
    .orderBy('good_id')
    .execute();
  return new Map(
    rows.map((row) => [row.good_id, Number(row.quantity) - (held ? 0 : Number(row.reserved))]),
  );
}

/** Départ d'un voyage : daté de l'instant de jeu (la base date de l'instant réel), arrivée à la même durée. */
async function backdateVoyage(city: City, voyageId: string, at: Date) {
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

/** Départ d'un voyage, daté de `now`, avec la cargaison donnée (sur lest si elle est vide). */
async function depart(carrier: Carrier, from: City, to: City, cargo: CargoLine[], now: Date) {
  const route = shipRoute(config, from.slug, to.slug);
  if (!route) throw new Error(`No route ${from.slug} ${to.slug}`);
  const cost = departureCost({
    provisionsOboles: routeProvisionsOboles(route, SHIP_CLASS),
    portDuesBaseOboles: portDuesBaseOboles(config, SHIP_CLASS),
    cityCoefficientBps: cityPortDuesCoefficientBps(config, to.slug),
    burnShareBps: config.ships.portDues.burnShareBps,
  });
  if (cost.totalOboles > 0) throw new Error('Voyage costs are not counted by the bench');
  const departed = await from.send(carrier.user, 'voyage.depart', {
    shipId: carrier.shipId,
    fromCityId: from.cityId,
    toCityId: to.cityId,
    cargo,
    expectedCostOboles: cost.totalOboles,
  });
  assertAdmitted(departed, false, 'voyage.depart');
  await backdateVoyage(from, departed.data.voyageId, now);
  carrier.waitedHours = 0;
}

/**
 * Ce que l'armateur doit porter à `target`, par bien : sa part de `TARGET_DAYS` jours de la demande de la cité, moins
 * son stock déjà sur place, en vente ou non.
 */
async function needsOf(carrier: Carrier, target: City, demandOf: Demand) {
  const [there, demand] = [await stocksIn(target, carrier, true), await demandOf(target)];
  const needs = new Map<string, number>();
  for (const [goodId, share] of carrier.deliver.get(target.cityId) ?? [])
    needs.set(
      goodId,
      Math.max(
        0,
        Math.ceil(TARGET_DAYS * share * (demand.get(goodId) ?? 0)) - (there.get(goodId) ?? 0),
      ),
    );
  return needs;
}

/**
 * Achats dans `market` de ce qui manque à `needs` (moins le stock de l'armateur sur place), la soute partagée au
 * prorata de ces manques, dans la limite de la trésorerie ; ce qui n'a pas trouvé de vendeur est aussitôt retiré, la
 * monnaie sous séquestre ne payant pas l'entretien. Rend vrai s'il ne manque plus rien.
 */
async function buyFor(carrier: Carrier, market: City, needs: ReadonlyMap<string, number>) {
  const shipClass = shipClassOf();
  const here = await stocksIn(market, carrier);
  const reserve =
    RESERVE_DAYS *
    carrier.sites.reduce(
      (sum, site) =>
        sum +
        upkeepOf(site.recipeId) +
        recipeOf(site.recipeId).workers * (wageOf(carrier.home) + worstLodging(carrier.home)),
      0,
    );
  const goods = [...needs];
  const missing = goods.map(([goodId, need]) => Math.max(0, need - (here.get(goodId) ?? 0)));
  const loaded = goods.reduce(
    (sum, [goodId, need]) => sum + Math.min(need, here.get(goodId) ?? 0),
    0,
  );
  const room = Math.max(0, shipClass.capacityUnits - loaded);
  const total = missing.reduce((sum, quantity) => sum + quantity, 0);
  const scale = total > room ? room / total : 1;
  let short = 0;
  for (const [index, [goodId]] of goods.entries()) {
    const price = postedPrice(goodId, 'buy');
    const affordable = Math.floor(((await cash(market, carrier.houseId)) - reserve) / price);
    const wanted = Math.floor((missing[index] ?? 0) * scale);
    const quantity = Math.min(wanted, affordable);
    if (quantity <= 0) {
      short += wanted;
      continue;
    }
    const before = await free(market, carrier.houseId, goodId);
    if (!(await place(market, carrier, goodId, 'buy', price, quantity))) continue;
    await cancelIn(market, carrier, 'buy');
    short += wanted - ((await free(market, carrier.houseId, goodId)) - before);
  }
  return short === 0;
}

/**
 * Remise en vente, dans `city`, de ce que l'armateur y a apporté : à son prix affiché, ou, pour ce que son site récolte,
 * au prix d'un intendant, comme une maison qui lui confie ses récoltes. La récolte qu'il ne porte pas ailleurs reste à
 * quai : vendue chez lui, elle ferait baisser les prix de sa cité.
 */
async function relist(carrier: Carrier, city: City) {
  await cancelIn(city, carrier, 'sell');
  const stocks = await stocksIn(city, carrier);
  const harvested = new Set(
    carrier.sites.flatMap((site) => recipeOf(site.recipeId).outputs.map((stack) => stack.goodId)),
  );
  for (const goodId of (carrier.deliver.get(city.cityId) ?? new Map<string, number>()).keys()) {
    const price = harvested.has(goodId) ? stewardPrice(goodId) : postedPrice(goodId, 'sell');
    await place(city, carrier, goodId, 'sell', price, stocks.get(goodId) ?? 0);
  }
}

/**
 * Matinée d'un armateur : navire acheté s'il n'en a pas, récolte de son site d'attache, remises en vente aux deux
 * bouts, puis le pas d'un tick. Rend le prix du navire acheté ce matin (0 sinon).
 */
export async function carrierMorning(carrier: Carrier, now: Date, demandOf: Demand) {
  const { home, source } = carrier;
  const shipClass = shipClassOf();
  let bought = 0;
  if (!carrier.shipId && (await cash(home, carrier.houseId)) >= shipClass.purchaseCostOboles) {
    const acquired = await home.send(carrier.user, 'ship.acquire', {
      classId: SHIP_CLASS,
      expectedCostOboles: shipClass.purchaseCostOboles,
    });
    assertAdmitted(acquired, true, 'ship.acquire');
    if (acquired.ok)
      [carrier.shipId, bought] = [acquired.data.shipId, shipClass.purchaseCostOboles];
  }
  await harvest(home, carrier, now);
  await relist(carrier, home);
  await relist(carrier, source);
  await carrierStep(carrier, now, demandOf);
  return bought;
}

/**
 * Un pas d'armateur, à l'instant de jeu `now` : en mer, rien ; à quai dans un port, il y remet en vente ce qu'il a
 * apporté, achète ce qui manque à l'autre bout, et part quand ses achats sont faits, que sa soute est à moitié pleine
 * ou qu'il a assez attendu.
 */
export async function carrierStep(carrier: Carrier, now: Date, demandOf: Demand) {
  if (!carrier.shipId) return;
  const docked = (
    await carrier.home.db
      .selectFrom('game.ships')
      .select('docked_city_id')
      .where('id', '=', carrier.shipId)
      .executeTakeFirstOrThrow()
  ).docked_city_id;
  const here = [carrier.home, carrier.source].find((city) => city.cityId === docked);
  if (!here) return;
  const there = here === carrier.home ? carrier.source : carrier.home;
  await relist(carrier, here);
  const needs = await needsOf(carrier, there, demandOf);
  const done = await buyFor(carrier, here, needs);
  const shipClass = shipClassOf();
  const stocks = await stocksIn(here, carrier);
  // Cargaison : ce qui manque à l'autre bout, pas davantage ; le reste de la récolte attend à quai.
  const cargo: CargoLine[] = [];
  for (const [goodId, need] of needs) {
    const quantity = Math.min(
      stocks.get(goodId) ?? 0,
      need,
      shipClass.capacityUnits - cargoUnits(cargo),
    );
    if (quantity > 0) cargo.push({ goodId, quantity });
  }
  carrier.waitedHours += 1;
  const full = cargoUnits(cargo) * LOAD_SHARE >= shipClass.capacityUnits;
  if (done || full || carrier.waitedHours > MAX_WAIT_HOURS)
    await depart(carrier, here, there, cargo, now);
}

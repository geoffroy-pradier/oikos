import { readHousing } from '@oikos/db';
import { holdingUnits, lodgingPrice, wornCondition } from '@oikos/sim';
import {
  cash,
  closeOf,
  free,
  lodgingOf,
  recipeOf,
  referenceOf,
  wageOf,
  worstLodging,
  type City,
  type House,
} from './city';
import { dateLease, datePurchase } from './dates';
import { place, upkeepOf, type Seller } from './strategy';
import { worldConfig } from './world';

/*
 * Stratégie de logement du banc des quatre cités (#282, docs/specs/04-systemes-gestion.md 4.5) : une maison
 * qui emploie des travailleurs sans logement paie chaque nuit leur hébergement chez les PNJ ; elle loue un
 * logement offert, ou l'achète à la cité, quand cela lui coûte moins ; elle rénove ses biens avant qu'ils
 * passent sous leur seuil d'habitabilité ; une maison dont les travailleurs sont logés investit ses surplus
 * dans des logements qu'elle met en location, et loue ceux qu'elle n'utilise pas. Les prix et
 * les seuils viennent de la configuration jouée ; les constantes ci-dessous sont des choix de stratégie, pas
 * de l'équilibrage du jeu.
 */
/** Jours de dépenses courantes (sites, travailleurs, biens, loyers) qu'une maison garde en réserve : la durée d'une mise en route, où une maison perd de l'argent avant que ses prix s'ajustent. */
const RESERVE_DAYS = 10;
/** Horizon d'un investissement, en mandats d'archonte : quatre années de jeu (6.2). */
const HORIZON_TERMS = 4;
const termDays = worldConfig.politics?.archon.termDays;
if (!termDays) throw new Error('The played configuration has no archon term');
const HORIZON_DAYS = HORIZON_TERMS * termDays;
/** Part de l'hébergement économisé que le propriétaire demande en loyer : le locataire y gagne toujours. */
const RENT_SHARE_BPS = 8000;
/** Jours d'avance avec lesquels un bien est rénové : il ne passe jamais sous son seuil d'habitabilité. */
const RENOVATION_LEAD_DAYS = 3;
/** Prix d'achat maximal des biens de rénovation, en multiple du prix de référence. */
const RENOVATION_BID = 1.5;

/** Place d'un bien dans sa cité, unique (`properties_lot_unique`) et la même d'une partie à l'autre, au contraire de son identifiant. */
export interface Lot {
  sizeId: string;
  lot: number;
}
/** Bien offert à la location. */
export interface LeaseOffer extends Lot {
  propertyId: string;
  units: number;
  rentOboles: number;
}
/** Bien que la cité détient encore. */
export interface Vacant extends Lot {
  propertyId: string;
  units: number;
  priceOboles: number;
  upkeepOboles: number;
}
export type Move =
  | { kind: 'lease'; propertyId: string; rentOboles: number }
  | { kind: 'buy'; propertyId: string; priceOboles: number };

/** Loyer demandé pour un bien : une part de ce que son logement économise à un employeur, par nuit. */
export const rentOf = (units: number, lodgingOboles: number) =>
  Math.floor((units * lodgingOboles * RENT_SHARE_BPS) / 10_000);

/**
 * Biens d'une même cité par taille puis par lot : les ex aequo se départagent ainsi de la même façon à chaque
 * partie de même graine, quand un tri par identifiant, tiré à chaque monde, désignerait un autre bien.
 */
const byLot = (a: Lot, b: Lot) =>
  a.sizeId < b.sizeId ? -1 : a.sizeId > b.sizeId ? 1 : a.lot - b.lot;

/**
 * Choix d'une maison qui emploie `unhoused` travailleurs sans logement, à `lodging` oboles la nuit chacun :
 * un bail d'abord, au plus fort gain quotidien (un loyer sous l'hébergement économisé), sans immobiliser de
 * monnaie ; sinon l'achat qui rapporte le plus sur l'horizon, sous la monnaie disponible (`spendable`).
 */
export function chooseTenancy(input: {
  unhoused: number;
  lodging: number;
  leases: readonly LeaseOffer[];
  vacant: readonly Vacant[];
  spendable: number;
}): Move | undefined {
  const saved = (units: number) => Math.min(units, input.unhoused) * input.lodging;
  const lease = [...input.leases]
    .sort(byLot)
    .map((offer) => ({ offer, gain: saved(offer.units) - offer.rentOboles }))
    .filter(({ gain }) => gain > 0)
    .sort((a, b) => b.gain - a.gain)[0];
  if (lease)
    return {
      kind: 'lease',
      propertyId: lease.offer.propertyId,
      rentOboles: lease.offer.rentOboles,
    };
  const buy = [...input.vacant]
    .sort(byLot)
    .filter((property) => property.priceOboles <= input.spendable)
    .map((property) => ({
      property,
      gain: (saved(property.units) - property.upkeepOboles) * HORIZON_DAYS - property.priceOboles,
    }))
    .filter(({ gain }) => gain > 0)
    .sort((a, b) => b.gain - a.gain)[0];
  return (
    buy && {
      kind: 'buy',
      propertyId: buy.property.propertyId,
      priceOboles: buy.property.priceOboles,
    }
  );
}

/**
 * Choix d'un propriétaire : le bien de la cité dont les loyers rapportent le plus sur l'horizon (loyer
 * demandé, entretien déduit, supposé loué chaque jour), s'il dépasse son prix et tient dans `spendable`.
 */
export function chooseInvestment(input: {
  lodging: number;
  vacant: readonly Vacant[];
  spendable: number;
}): Move | undefined {
  const best = [...input.vacant]
    .sort(byLot)
    .filter((property) => property.priceOboles <= input.spendable)
    .map((property) => ({
      property,
      gain:
        (rentOf(property.units, input.lodging) - property.upkeepOboles) * HORIZON_DAYS -
        property.priceOboles,
    }))
    .filter(({ gain }) => gain > 0)
    .sort((a, b) => b.gain - a.gain)[0];
  return (
    best && {
      kind: 'buy',
      propertyId: best.property.propertyId,
      priceOboles: best.property.priceOboles,
    }
  );
}

/** Biens que la maison n'utilise pas pour loger ses travailleurs, à louer : les premiers (par taille puis lot) les logent. */
export function spareProperties(
  owned: readonly (Lot & { id: string; units: number; leased: boolean })[],
  workers: number,
) {
  let housed = 0;
  const spare: string[] = [];
  for (const property of [...owned].sort(byLot)) {
    if (property.leased) continue;
    if (housed < workers) housed += property.units;
    else spare.push(property.id);
  }
  return spare;
}

/** Un bien est rénové quand, dans `RENOVATION_LEAD_DAYS` jours d'usure, il passerait sous son seuil d'habitabilité. */
export const renovationDue = (condition: number, wear: number, minHabitable: number) =>
  condition - RENOVATION_LEAD_DAYS * wear < minHabitable;

/** Biens de logement acquis par les maisons (pour l'entretien dû), et ce que la stratégie a dépensé. */
export interface Housing {
  estates: { houseId: string; sizeId: string; acquiredAt: Date }[];
  /** Montants détruits, en oboles, d'après la configuration : achats à la cité et rénovations. */
  purchased: number;
  works: number;
  /** Actes, pour que le banc vérifie que chaque voie a servi. */
  bought: number;
  leased: number;
  renovated: number;
}
export const newHousing = (): Housing => ({
  estates: [],
  purchased: 0,
  works: 0,
  bought: 0,
  leased: 0,
  renovated: 0,
});

const sizeOf = (sizeId: string) => {
  const size = worldConfig.properties.sizes.find((candidate) => candidate.id === sizeId);
  if (!size) throw new Error(`Unknown property size ${sizeId}`);
  return size;
};

/** Entretien des biens dû à la clôture du jour `day`, d'après les achats du banc faits avant elle. */
export const propertyUpkeepDue = (city: City, housing: Housing, day: number) =>
  housing.estates
    .filter((estate) => estate.acquiredAt < closeOf(city, day))
    .reduce((sum, estate) => sum + sizeOf(estate.sizeId).dailyUpkeepOboles, 0);

/**
 * Hébergement chez les PNJ dû à la clôture du jour `day` : pour chaque cité, les travailleurs des sites créés
 * avant elle moins les logements utiles de leur maison (après la vétusté du jour, que la clôture applique
 * avant de lire les logements), au prix de la pénurie de la cité (`lodgingPrice`). Les biens sont lus avant
 * la clôture ; l'entretien impayé et les baux interrompus n'y changent rien, le banc exigeant qu'il n'y en ait pas.
 */
export async function lodgingDue(
  world: City,
  residents: readonly { city: City; house: House }[],
  day: number,
) {
  const { sizes } = world.played.properties;
  const units = new Map<string, number>();
  for (const row of await readHousing(world.db, { worldId: world.worldId })) {
    const size = sizes.find((candidate) => candidate.id === row.sizeId);
    const worn = wornCondition(row.condition, size?.dailyWear ?? 0);
    units.set(
      row.houseId,
      (units.get(row.houseId) ?? 0) + holdingUnits({ ...row, condition: worn }, sizes),
    );
  }
  const cities = new Map<string, { workers: number; unhoused: number }>();
  for (const { city, house } of residents) {
    const workers = house.sites
      .filter((site) => site.createdAt < closeOf(world, day))
      .reduce((sum, site) => sum + recipeOf(site.recipeId).workers, 0);
    const total = cities.get(city.cityId) ?? { workers: 0, unhoused: 0 };
    total.workers += workers;
    total.unhoused += Math.max(0, workers - (units.get(house.houseId) ?? 0));
    cities.set(city.cityId, total);
  }
  const { baseOboles, ...curve } = world.played.labor.lodging;
  return [...cities.values()].reduce(
    (sum, city) => sum + city.unhoused * lodgingPrice({ baseOboles, ...city, curve }),
    0,
  );
}

/**
 * Matinée de logement d'une maison, après sa matinée de production : rénovation des biens qui s'usent
 * (biens achetés au marché, gardés hors vente), loyers réalignés pour un propriétaire, puis un bail ou un
 * achat (un bail seulement si `buys` est faux). Les commandes sont celles du jeu ; les dates de l'achat et du bail
 * sont ramenées à `now`.
 */
export async function housingMorning(
  city: City,
  house: Seller,
  now: Date,
  housing: Housing,
  buys = true,
) {
  const lodging = await lodgingOf(city);
  const owned = await city.db
    .selectFrom('game.properties as p')
    .leftJoin('game.leases as l', (join) =>
      join.onRef('l.property_id', '=', 'p.id').on('l.ended_at', 'is', null),
    )
    .leftJoin('game.property_listings as o', (join) =>
      join.onRef('o.property_id', '=', 'p.id').on('o.closed_at', 'is', null),
    )
    .select([
      'p.id',
      'p.size_id',
      'p.lot',
      'p.condition',
      'l.id as lease',
      'o.price_oboles as listed',
    ])
    .where('p.owner_house_id', '=', house.houseId)
    .orderBy('p.size_id')
    .orderBy('p.lot')
    .execute();
  const rented = (
    await city.db
      .selectFrom('game.leases')
      .select('rent_oboles')
      .where('tenant_house_id', '=', house.houseId)
      .where('ended_at', 'is', null)
      .execute()
  ).reduce((sum, lease) => sum + Number(lease.rent_oboles), 0);

  // Rénovation : les biens que l'usure de `RENOVATION_LEAD_DAYS` jours ferait passer sous le seuil.
  const kept = new Map<string, number>();
  for (const property of owned) {
    const size = sizeOf(property.size_id);
    if (!renovationDue(property.condition, size.dailyWear, size.minHabitableCondition)) continue;
    const { oboles, goods } = size.renovation;
    const missing: { goodId: string; quantity: number }[] = [];
    for (const { goodId, quantity } of goods) {
      kept.set(goodId, (kept.get(goodId) ?? 0) + quantity);
      const lack = quantity - (await free(city, house.houseId, goodId));
      if (lack > 0) missing.push({ goodId, quantity: lack });
    }
    if (missing.length === 0 && (await cash(city, house.houseId)) >= oboles) {
      const renovated = await city.send(house.user, 'property.renovate', {
        propertyId: property.id,
        expectedCostOboles: oboles,
        expectedGoods: goods,
      });
      if (!renovated.ok) throw new Error(`property.renovate: ${renovated.error?.code}`);
      housing.works += oboles;
      housing.renovated += 1;
    } else
      for (const { goodId, quantity } of missing)
        await place(city, house, goodId, 'buy', referenceOf(goodId) * RENOVATION_BID, quantity);
  }
  house.kept = kept;

  // Loyers : les biens que la maison n'utilise pas sont offerts, réalignés chaque matin sur l'hébergement qu'ils économisent.
  const workers = house.sites.reduce((sum, site) => sum + recipeOf(site.recipeId).workers, 0);
  const spare = new Set(
    spareProperties(
      owned.map((property) => ({
        id: property.id,
        sizeId: property.size_id,
        lot: property.lot,
        units: sizeOf(property.size_id).housingUnits,
        leased: property.lease !== null,
      })),
      workers,
    ),
  );
  for (const property of owned) {
    if (property.lease) continue;
    const rent = spare.has(property.id)
      ? rentOf(sizeOf(property.size_id).housingUnits, lodging)
      : 0;
    if (property.listed !== null && Number(property.listed) === rent) continue;
    if (property.listed !== null) {
      const withdrawn = await city.send(house.user, 'property.withdrawOffer', {
        propertyId: property.id,
      });
      if (!withdrawn.ok) throw new Error(`property.withdrawOffer: ${withdrawn.error?.code}`);
    }
    if (rent <= 0) continue;
    const offered = await city.send(house.user, 'property.offerLease', {
      propertyId: property.id,
      rentOboles: rent,
    });
    if (!offered.ok) throw new Error(`property.offerLease: ${offered.error?.code}`);
  }

  // Bail ou achat : les dépenses courantes d'une maison (sites, travailleurs, biens, loyers) restent couvertes.
  if (lodging <= 0) return;
  const outgoings =
    house.sites.reduce((sum, site) => sum + upkeepOf(site.recipeId), 0) +
    workers * (wageOf(city) + worstLodging(city)) +
    owned.reduce((sum, property) => sum + sizeOf(property.size_id).dailyUpkeepOboles, 0) +
    rented;
  const spendable = buys ? (await cash(city, house.houseId)) - RESERVE_DAYS * outgoings : 0;
  const holdings = await readHousing(city.db, { houseId: house.houseId });
  const housed = holdings.reduce(
    (sum, row) => sum + holdingUnits(row, worldConfig.properties.sizes),
    0,
  );
  const vacant: Vacant[] = (
    await city.db
      .selectFrom('game.properties')
      .select(['id', 'size_id', 'lot'])
      .where('city_id', '=', city.cityId)
      .where('owner_house_id', 'is', null)
      .orderBy('size_id')
      .orderBy('lot')
      .execute()
  ).map((row) => ({
    propertyId: row.id,
    sizeId: row.size_id,
    lot: row.lot,
    units: sizeOf(row.size_id).housingUnits,
    priceOboles: sizeOf(row.size_id).purchasePriceOboles,
    upkeepOboles: sizeOf(row.size_id).dailyUpkeepOboles,
  }));
  const unhoused = Math.max(0, workers - housed);
  const move =
    unhoused === 0
      ? chooseInvestment({ lodging, vacant, spendable })
      : chooseTenancy({
          unhoused,
          lodging,
          leases: (
            await city.db
              .selectFrom('game.property_listings as o')
              .innerJoin('game.properties as p', 'p.id', 'o.property_id')
              .select(['p.id', 'p.size_id', 'p.lot', 'o.price_oboles'])
              .where('p.city_id', '=', city.cityId)
              .where('o.kind', '=', 'lease')
              .where('o.house_id', '!=', house.houseId)
              .where('o.closed_at', 'is', null)
              .orderBy('p.size_id')
              .orderBy('p.lot')
              .execute()
          ).map((row) => ({
            propertyId: row.id,
            sizeId: row.size_id,
            lot: row.lot,
            units: sizeOf(row.size_id).housingUnits,
            rentOboles: Number(row.price_oboles),
          })),
          vacant,
          spendable,
        });
  if (!move) return;
  if (move.kind === 'lease') {
    const leased = await city.send(house.user, 'property.lease', {
      propertyId: move.propertyId,
      expectedRentOboles: move.rentOboles,
    });
    if (!leased.ok) throw new Error(`property.lease: ${leased.error?.code}`);
    await dateLease(city, leased.data.leaseId, now);
    housing.leased += 1;
  } else {
    const bought = await city.send(house.user, 'property.buy', {
      propertyId: move.propertyId,
      expectedPriceOboles: move.priceOboles,
    });
    if (!bought.ok) throw new Error(`property.buy: ${bought.error?.code}`);
    await datePurchase(city, move.propertyId, now);
    housing.estates.push({ houseId: house.houseId, sizeId: bought.data.sizeId, acquiredAt: now });
    housing.purchased += move.priceOboles;
    housing.bought += 1;
  }
}

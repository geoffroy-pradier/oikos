import { z } from 'zod';

const id = z.string().min(1);

/** Parc de logements d'une cité pour une taille : biens au total, et ceux que la cité vend encore (4.5). */
export interface ParkSize {
  sizeId: string;
  total: number;
  forSale: number;
}

const parkRow = z.object({ id, size_id: id, for_sale: z.boolean() });

/**
 * Parc de logements d'une cité (vue publique `city_properties`), par taille, dans l'ordre des
 * identifiants. `null` si une ligne est illisible : l'écran annonce un échec de lecture.
 */
export function parkBySize(rows: unknown): ParkSize[] | null {
  const parsed = z.array(parkRow).safeParse(rows);
  if (!parsed.success) return null;
  const sizes = new Map<string, ParkSize>();
  for (const row of parsed.data) {
    const size = sizes.get(row.size_id) ?? { sizeId: row.size_id, total: 0, forSale: 0 };
    size.total += 1;
    if (row.for_sale) size.forSale += 1;
    sizes.set(row.size_id, size);
  }
  return [...sizes.values()].sort((a, b) => a.sizeId.localeCompare(b.sizeId));
}

const oboles = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const condition = z.number().int().min(0).max(10_000);
const stack = z.object({ goodId: id, quantity: z.number().int().positive() });

/** Une taille de bien, telle que le client la lit (vue `property_rules`, 4.5). */
export interface PropertySize {
  id: string;
  purchasePriceOboles: number;
  housingUnits: number;
  dailyUpkeepOboles: number;
  minHabitableCondition: number;
  renovation: { oboles: number; goods: { goodId: string; quantity: number }[] };
}

/**
 * Règles de l'immobilier de la configuration en vigueur, par taille. Schéma souple sur la forme (un
 * champ nouveau reste lisible), tenu sur les valeurs ; sans section (version antérieure), aucune taille.
 * `null` : illisible.
 */
export function parsePropertyRules(raw: unknown): Map<string, PropertySize> | null {
  const size = z.object({
    id,
    purchasePriceOboles: oboles,
    housingUnits: oboles,
    dailyUpkeepOboles: oboles,
    minHabitableCondition: condition,
    renovation: z.object({ oboles, goods: z.array(stack) }),
  });
  const parsed = z
    .object({ properties: z.object({ sizes: z.array(size) }).nullable() })
    .safeParse(raw ?? { properties: null });
  if (!parsed.success) return null;
  return new Map((parsed.data.properties?.sizes ?? []).map((entry) => [entry.id, entry]));
}

/** Un bien offert : par la cité, au prix de sa taille, ou par une maison, à la vente ou à la location. */
export interface Offer {
  propertyId: string;
  cityId: string;
  sizeId: string;
  lot: number;
  /** État du bien ; `null` : inconnu (bien de la cité non encore lu). */
  condition: number | null;
  kind: 'citySale' | 'sale' | 'lease';
  priceOboles: number;
  /**
   * Entretien impayé du bien offert par une maison, qu'il garde à la revente et qui le prive de loger :
   * `null` s'il est payé (toujours pour un bien de la cité) ; sinon, le jour de jeu où une clôture l'a
   * constaté (`day`), `null` si la base ne le date pas (aucune horloge en vigueur).
   */
  unpaid: { day: number | null } | null;
}

const offerRow = z.object({
  property_id: id,
  city_id: id,
  size_id: id,
  lot: z.number().int(),
  condition,
  kind: z.enum(['sale', 'lease']),
  price_oboles: oboles,
  upkeep_unpaid: z.boolean(),
  upkeep_unpaid_day: z.number().int().nullable(),
});
const cityRow = z.object({
  id,
  city_id: id,
  size_id: id,
  lot: z.number().int(),
  for_sale: z.boolean(),
  condition: condition.nullable(),
});

/**
 * Biens offerts : ceux que la cité vend encore (vue `city_properties`), au prix de leur taille, puis les
 * offres des maisons avec l'entretien impayé de leur bien (vue `property_offers_upkeep`, #403). Une
 * taille que la configuration ne connaît plus n'a pas de prix : son bien n'est pas proposé. `null` si une
 * ligne est illisible.
 */
export function parseOffers(
  cityRows: unknown,
  offerRows: unknown,
  sizes: ReadonlyMap<string, PropertySize>,
): Offer[] | null {
  const city = z.array(cityRow).safeParse(cityRows);
  const offers = z.array(offerRow).safeParse(offerRows);
  if (!city.success || !offers.success) return null;
  const byCity = city.data.flatMap((row): Offer[] => {
    const size = sizes.get(row.size_id);
    return row.for_sale && size
      ? [
          {
            propertyId: row.id,
            cityId: row.city_id,
            sizeId: row.size_id,
            lot: row.lot,
            condition: row.condition,
            kind: 'citySale',
            priceOboles: size.purchasePriceOboles,
            unpaid: null,
          },
        ]
      : [];
  });
  const byHouses = offers.data.map((row): Offer => ({
    propertyId: row.property_id,
    cityId: row.city_id,
    sizeId: row.size_id,
    lot: row.lot,
    condition: row.condition,
    kind: row.kind,
    priceOboles: row.price_oboles,
    unpaid: row.upkeep_unpaid ? { day: row.upkeep_unpaid_day } : null,
  }));
  // Par cité, taille puis lot : le bien d'une cité se retrouve à la même place d'une lecture à l'autre.
  return [...byCity, ...byHouses].sort(
    (a, b) => a.cityId.localeCompare(b.cityId) || a.sizeId.localeCompare(b.sizeId) || a.lot - b.lot,
  );
}

/** Un bien de la maison (vue `my_properties`). */
export interface MyProperty {
  id: string;
  cityId: string;
  sizeId: string;
  lot: number;
  condition: number;
  /** Entretien impayé depuis cette date ; `null` : payé. */
  unpaidSince: string | null;
}

const mineRow = z.object({
  id,
  city_id: id,
  size_id: id,
  lot: z.number().int(),
  condition,
  upkeep_unpaid_since: z.string().nullable(),
});

/** Biens de la maison, par cité puis par lot. `null` si une ligne est illisible. */
export function parseMyProperties(rows: unknown): MyProperty[] | null {
  const parsed = z.array(mineRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .map((row) => ({
      id: row.id,
      cityId: row.city_id,
      sizeId: row.size_id,
      lot: row.lot,
      condition: row.condition,
      unpaidSince: row.upkeep_unpaid_since,
    }))
    .sort((a, b) => a.cityId.localeCompare(b.cityId) || a.lot - b.lot);
}

/** Un bail dont la maison est partie (vue `my_leases`). */
export interface Lease {
  id: string;
  propertyId: string;
  cityId: string;
  sizeId: string;
  lot: number;
  /** La maison est-elle locataire ? Sinon propriétaire. */
  asTenant: boolean;
  rentOboles: number;
  /** Fin demandée, effective à la prochaine clôture. */
  ending: boolean;
  /** Bail terminé : `requested` (demandé) ou `unpaid` (loyer impayé). */
  endReason: 'requested' | 'unpaid' | null;
  endedAt: string | null;
  /** Jour de jeu de la clôture qui a terminé le bail. */
  endedDay: number | null;
}

const leaseRow = z.object({
  id,
  property_id: id,
  city_id: id,
  size_id: id,
  lot: z.number().int(),
  tenant_house_id: id,
  rent_oboles: oboles,
  end_requested_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  ended_day: z.number().int().nullable(),
  end_reason: z.enum(['requested', 'unpaid']).nullable(),
});

/** Baux de la maison (`houseId`), en cours d'abord. `null` si une ligne est illisible. */
export function parseLeases(rows: unknown, houseId: string): Lease[] | null {
  const parsed = z.array(leaseRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .map((row) => ({
      id: row.id,
      propertyId: row.property_id,
      cityId: row.city_id,
      sizeId: row.size_id,
      lot: row.lot,
      asTenant: row.tenant_house_id === houseId,
      rentOboles: row.rent_oboles,
      ending: row.end_requested_at !== null && row.ended_at === null,
      endReason: row.end_reason,
      endedAt: row.ended_at,
      endedDay: row.ended_day,
    }))
    .sort(
      // En cours d'abord, par lot ; puis les baux terminés, du plus récent au plus ancien.
      (a, b) =>
        Number(a.endedAt !== null) - Number(b.endedAt !== null) ||
        (b.endedAt ?? '').localeCompare(a.endedAt ?? '') ||
        a.lot - b.lot,
    );
}

/** État d'un bien en fraction (0 à 1), pour `Intl.NumberFormat` en pourcentage, arrondi vers le bas. */
export const conditionShare = (value: number) => Math.floor(value / 100) / 100;

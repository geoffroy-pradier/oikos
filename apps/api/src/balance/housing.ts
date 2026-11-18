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
/** Horizon d'un investissement, en mandats d'archonte : quatre années de jeu (6.2). */
const HORIZON_TERMS = 4;
const termDays = worldConfig.politics?.archon.termDays;
if (!termDays) throw new Error('The played configuration has no archon term');
const HORIZON_DAYS = HORIZON_TERMS * termDays;
/** Part de l'hébergement économisé que le propriétaire demande en loyer : le locataire y gagne toujours. */
const RENT_SHARE_BPS = 8000;
/** Jours d'avance avec lesquels un bien est rénové : il ne passe jamais sous son seuil d'habitabilité. */
const RENOVATION_LEAD_DAYS = 3;

/** Bien offert à la location. */
export interface LeaseOffer {
  propertyId: string;
  units: number;
  rentOboles: number;
}
/** Bien que la cité détient encore. */
export interface Vacant {
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

const byId = <T extends { propertyId: string }>(a: T, b: T) =>
  a.propertyId < b.propertyId ? -1 : 1;

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
    .sort(byId)
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
    .sort(byId)
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
    .sort(byId)
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

/** Biens que la maison n'utilise pas pour loger ses travailleurs, à louer : les premiers (par identifiant) les logent. */
export function spareProperties(
  owned: readonly { id: string; units: number; leased: boolean }[],
  workers: number,
) {
  let housed = 0;
  const spare: string[] = [];
  for (const property of [...owned].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (property.leased) continue;
    if (housed < workers) housed += property.units;
    else spare.push(property.id);
  }
  return spare;
}

/** Un bien est rénové quand, dans `RENOVATION_LEAD_DAYS` jours d'usure, il passerait sous son seuil d'habitabilité. */
export const renovationDue = (condition: number, wear: number, minHabitable: number) =>
  condition - RENOVATION_LEAD_DAYS * wear < minHabitable;

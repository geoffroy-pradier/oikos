import { shareRoundedUp } from './tax';

/**
 * Voyages (docs/specs/04-systemes-gestion.md, 4.6 ; docs/specs/05-economie.md, 5.6) : calcul pur, en
 * secondes et en oboles entières. Le départ d'un navire paie ses provisions et le droit de port de la cité
 * d'arrivée ; chaque arrondi se fait vers le haut, jamais en faveur de la monnaie en circulation.
 */
const BPS = 10_000;
const SECONDS_PER_HOUR = 3_600;

const nonNegative = (name: string, value: number) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative integer`);
};

/**
 * Durée d'un trajet, en secondes : la durée de référence de la route (navire de vitesse 10 000) divisée
 * par la vitesse du navire, ⌈heures × 3 600 × 10 000 ÷ vitesse⌉. Arrondie à la seconde supérieure : un
 * navire n'arrive jamais avant l'instant exact.
 */
export function voyageDurationSeconds(routeHours: number, speedBps: number): number {
  if (!Number.isSafeInteger(routeHours) || routeHours <= 0)
    throw new RangeError('routeHours must be a positive integer');
  if (!Number.isSafeInteger(speedBps) || speedBps <= 0)
    throw new RangeError('speedBps must be a positive integer');
  const reference = routeHours * SECONDS_PER_HOUR * BPS;
  if (!Number.isSafeInteger(reference)) throw new RangeError('routeHours is too large');
  return Math.ceil(reference / speedBps);
}

export interface PortDues {
  /** Le droit dû : ⌈forfait × coefficient de la cité ÷ 10 000⌉. */
  oboles: number;
  /** Part détruite (puits `sink_port_dues`) : ⌈droit × part détruite ÷ 10 000⌉. */
  burned: number;
  /** Part versée au trésor de la cité d'arrivée : le reste. */
  treasury: number;
}

/**
 * Droit de port d'une arrivée et sa répartition. Le forfait de la classe est modulé par le coefficient de
 * la cité d'arrivée (points de base, 10 000 = ×1), puis partagé comme la taxe de marché : la part détruite
 * d'abord, arrondie à l'obole supérieure, le reste au trésor.
 */
export function portDues(rule: {
  baseOboles: number;
  cityCoefficientBps: number;
  burnShareBps: number;
}): PortDues {
  nonNegative('baseOboles', rule.baseOboles);
  nonNegative('cityCoefficientBps', rule.cityCoefficientBps);
  if (!Number.isInteger(rule.burnShareBps) || rule.burnShareBps < 0 || rule.burnShareBps > BPS)
    throw new RangeError(`burnShareBps must be an integer between 0 and ${BPS}`);
  const oboles = shareRoundedUp(rule.baseOboles, rule.cityCoefficientBps);
  const burned = shareRoundedUp(oboles, rule.burnShareBps);
  return { oboles, burned, treasury: oboles - burned };
}

export interface DepartureCost {
  /** Provisions du voyage, détruites (puits `sink_voyage_provisions`). */
  provisionsOboles: number;
  portDues: PortDues;
  /** Ce que paie la maison au départ : provisions plus droit de port. */
  totalOboles: number;
}

/** Ce que coûte un départ : les provisions de la route pour la classe, plus le droit de port d'arrivée. */
export function departureCost(cost: {
  provisionsOboles: number;
  portDuesBaseOboles: number;
  cityCoefficientBps: number;
  burnShareBps: number;
}): DepartureCost {
  nonNegative('provisionsOboles', cost.provisionsOboles);
  const dues = portDues({
    baseOboles: cost.portDuesBaseOboles,
    cityCoefficientBps: cost.cityCoefficientBps,
    burnShareBps: cost.burnShareBps,
  });
  const totalOboles = cost.provisionsOboles + dues.oboles;
  if (!Number.isSafeInteger(totalOboles)) throw new RangeError('departure cost is too large');
  return { provisionsOboles: cost.provisionsOboles, portDues: dues, totalOboles };
}

/** Une ligne de la cargaison : un bien et sa quantité, en unités. */
export interface CargoLine {
  goodId: string;
  quantity: number;
}

/** Unités d'une cargaison, tous biens confondus : ce que la capacité d'un navire borne. */
export function cargoUnits(cargo: readonly CargoLine[]): number {
  let units = 0;
  for (const line of cargo) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0)
      throw new RangeError('each quantity must be a positive integer');
    units += line.quantity;
    if (!Number.isSafeInteger(units)) throw new RangeError('cargo is too large');
  }
  return units;
}

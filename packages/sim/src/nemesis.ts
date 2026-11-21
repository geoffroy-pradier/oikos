/**
 * Némésis (docs/specs/07-dieux-faveur-evenements.md, 7.2 ; #735) : ampleur d'une sanction et baisse de la jauge, calculs
 * purs en entiers. La jauge d'Hybris reste entre zéro et le plus grand entier sûr ; une part se compte en points de
 * base (10 000 : le tout) et ce qu'elle prend s'arrondit vers le bas, si bien qu'elle ne prend jamais plus que le tout.
 */
import { createRng } from './rng';

/** Part bornée que prend une sanction (incendie d'entrepôt, procès), en points de base. */
export interface NemesisShareBounds {
  minBps: number;
  maxBps: number;
}

const BPS = 10_000;

const safeCount = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative safe integer`);
  return value;
};

/** Excès de la jauge au-delà du seuil : nul au seuil ou en deçà. Némésis ne s'annonce et ne frappe qu'à un excès non nul. */
export function nemesisExcess(gauge: number, threshold: number): number {
  return Math.max(0, safeCount(gauge, 'gauge') - safeCount(threshold, 'threshold'));
}

/**
 * Excès compté dans la sanction, et baisse de la jauge qui la suit : l'excès, plafonné à `fullExcess`. Une jauge loin
 * au-delà du seuil y reste, et appelle un nouveau présage ; la baisse ne la fait jamais passer sous le seuil.
 */
export function nemesisRelief(excess: number, fullExcess: number): number {
  safeCount(excess, 'excess');
  if (safeCount(fullExcess, 'fullExcess') === 0)
    throw new RangeError('fullExcess must be positive');
  return Math.min(excess, fullExcess);
}

/**
 * Ampleur d'une sanction, en points de base : de `minBps` au moindre excès à `maxBps` à l'excès plein (`fullExcess`) ou
 * au-delà, au prorata entre les deux, arrondie vers le bas. Nulle sans excès : rien ne frappe. Croissante avec l'excès,
 * jamais au-delà de `maxBps`.
 */
export function nemesisMagnitudeBps(
  excess: number,
  bounds: NemesisShareBounds,
  fullExcess: number,
): number {
  const counted = nemesisRelief(excess, fullExcess);
  const { minBps, maxBps } = bounds;
  if (!Number.isSafeInteger(minBps) || !Number.isSafeInteger(maxBps) || minBps < 0)
    throw new RangeError('share bounds must be non-negative integers');
  if (maxBps > BPS || minBps > maxBps)
    throw new RangeError('share bounds are ordered and at most 10000');
  if (counted === 0) return 0;
  const span = BigInt(maxBps - minBps);
  return minBps + Number((span * BigInt(counted)) / BigInt(fullExcess));
}

/** Ce que prend une part de `magnitudeBps` points de base d'un montant ou d'une quantité, arrondi vers le bas. */
export function nemesisTake(amount: bigint, magnitudeBps: number): bigint {
  if (amount < 0n) throw new RangeError('amount must be non-negative');
  if (!Number.isSafeInteger(magnitudeBps) || magnitudeBps < 0 || magnitudeBps > BPS)
    throw new RangeError('magnitudeBps must be an integer between 0 and 10000');
  return (amount * BigInt(magnitudeBps)) / BigInt(BPS);
}

/**
 * Modèle d'une sanction, tiré avec la même chance parmi ceux en jeu, dans l'ordre donné, par un générateur propre à la
 * graine : la même graine rend le même modèle.
 */
export function drawNemesisModel<M extends string>(seed: string, models: readonly M[]): M {
  return createRng(`${seed}:nemesis:model`).pick(models);
}

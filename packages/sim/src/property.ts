/**
 * Immobilier urbain (docs/specs/04-systemes-gestion.md, 4.5 ; #256) : état d'un bien et logements qu'il
 * offre, calculs purs en entiers. La clôture quotidienne et les vues de lecture s'en servent.
 */

/**
 * État d'un bien neuf ou rénové. L'état se compte de 0 à 10 000, comme des points de base : c'est une
 * unité, pas un paramètre d'équilibrage (la vétusté et le seuil, eux, sont dans la configuration).
 */
export const PROPERTY_CONDITION_MAX = 10_000;

const checkCondition = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > PROPERTY_CONDITION_MAX)
    throw new RangeError(`${name} must be an integer from 0 to ${PROPERTY_CONDITION_MAX}`);
};

/**
 * État d'un bien après la vétusté d'un jour de jeu : il perd `dailyWear` points, sans passer sous zéro.
 * Une vétusté nulle le laisse tel quel ; un bien à zéro y reste.
 */
export function wornCondition(condition: number, dailyWear: number): number {
  checkCondition(condition, 'condition');
  checkCondition(dailyWear, 'dailyWear');
  return Math.max(0, condition - dailyWear);
}

/**
 * Logements qu'un bien offre : sa capacité s'il est en état de loger, rien sinon. Un bien ne loge
 * personne sous le seuil de vétusté de sa taille (un état égal au seuil loge encore), ni tant que
 * son entretien est impayé, jusqu'à la clôture qui le paie.
 */
export function usableHousingUnits(property: {
  housingUnits: number;
  condition: number;
  minHabitableCondition: number;
  upkeepUnpaid: boolean;
}): number {
  const { housingUnits, condition, minHabitableCondition, upkeepUnpaid } = property;
  if (!Number.isSafeInteger(housingUnits) || housingUnits < 0)
    throw new RangeError('housingUnits must be a non-negative integer');
  checkCondition(condition, 'condition');
  checkCondition(minHabitableCondition, 'minHabitableCondition');
  return upkeepUnpaid || condition < minHabitableCondition ? 0 : housingUnits;
}

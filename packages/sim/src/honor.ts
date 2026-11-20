/**
 * Timè (docs/specs/04-systemes-gestion.md, 4.1 ; #704) : variation de l'honneur d'une maison pour un motif,
 * calcul pur en entiers. La Timè n'est pas de la monnaie : elle ne s'achète ni ne se transfère.
 */

/** Bornes de la Timè et variation de chaque motif (`honor` de la configuration). */
export interface HonorBounds {
  min: number;
  max: number;
  changes: Readonly<Record<string, number>>;
}

const integer = (value: number, name: string) => {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer`);
};

/**
 * Variation de la Timè `balance` d'une maison pour un motif : celle de la configuration, rognée pour que la Timè
 * reste dans ses bornes. Un gain ne la fait jamais baisser, une perte jamais monter : une Timè déjà hors des
 * bornes (bornes resserrées par une version nouvelle) n'y est pas ramenée d'un coup, elle ne s'en éloigne plus.
 * Un motif sans variation, ou une Timè déjà à la borne, ne change rien (zéro : aucune ligne au journal).
 */
export function honorChange(balance: number, reason: string, bounds: HonorBounds): number {
  integer(balance, 'balance');
  integer(bounds.min, 'min');
  integer(bounds.max, 'max');
  if (bounds.min > 0 || bounds.max < 0) throw new RangeError('the bounds must include zero');
  if (!Object.hasOwn(bounds.changes, reason)) throw new RangeError(`unknown Timè reason ${reason}`);
  const change = bounds.changes[reason] ?? 0;
  integer(change, `changes.${reason}`);
  if (change > 0) return Math.max(0, Math.min(change, bounds.max - balance));
  if (change < 0) return Math.min(0, Math.max(change, bounds.min - balance));
  return 0;
}

/**
 * Liturgies (docs/specs/06-cites-politique-communaute.md, 6.4 ; #720) : accomplissement avec faste et prélèvement
 * d'office. Fonctions pures, en entiers ; la borne du faste et les gains viennent de la configuration (`liturgies`).
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const positive = (value: bigint, name: string) => {
  if (value < 1n || value > MAX_SAFE)
    throw new RangeError(`${name} must be a positive safe integer`);
};

/**
 * Faste le plus haut qu'une maison peut ajouter à son dû : ⌊dû × `maxSplendorBps` ÷ 10 000⌋, arrondi vers le bas, et
 * jamais au point que dû et faste ensemble dépassent les entiers sûrs. Une borne nulle n'admet aucun faste.
 */
export function maxSplendor(due: bigint, maxSplendorBps: number): bigint {
  positive(due, 'due');
  if (!Number.isSafeInteger(maxSplendorBps) || maxSplendorBps < 0)
    throw new RangeError('maxSplendorBps must be a non-negative integer');
  const bound = (due * BigInt(maxSplendorBps)) / 10_000n;
  return bound < MAX_SAFE - due ? bound : MAX_SAFE - due;
}

/**
 * Gain de Timè ou de Charis d'une liturgie accomplie : le gain de la configuration, fois ce qui est payé rapporté au
 * dû, ⌊gain × (dû + faste) ÷ dû⌋, arrondi vers le bas. Sans faste, c'est le gain lui-même ; il croît avec le faste, et
 * un faste égal au dû le double.
 */
export function liturgyGain(gain: number, due: bigint, splendor: bigint): number {
  if (!Number.isSafeInteger(gain) || gain < 0)
    throw new RangeError('gain must be a non-negative integer');
  positive(due, 'due');
  if (splendor < 0n) throw new RangeError('splendor must not be negative');
  const total = (BigInt(gain) * (due + splendor)) / due;
  if (total > MAX_SAFE) throw new RangeError('the liturgy gain exceeds the safe integer range');
  return Number(total);
}

/** Une liturgie échue à prélever : sa maison et son dû, en oboles. */
export interface LiturgyToLevy {
  houseId: string;
  due: bigint;
}

/**
 * Prélèvement d'office des liturgies échues (#720) : dans l'ordre donné, chacune prend son dû sur la trésorerie de sa
 * maison, en entier si elle le couvre, sinon tout ce qu'elle a ; le reste est abandonné, sans dette. Une trésorerie
 * négative ou absente compte pour zéro. Rend, dans le même ordre, ce que chaque liturgie prélève : la somme prélevée
 * sur une maison plus ce qui lui reste est sa trésorerie de départ.
 */
export function levyLiturgies<T extends LiturgyToLevy>(
  treasuries: ReadonlyMap<string, bigint>,
  liturgies: readonly T[],
): (T & { levied: bigint })[] {
  const left = new Map<string, bigint>();
  return liturgies.map((liturgy) => {
    positive(liturgy.due, 'due');
    const start = treasuries.get(liturgy.houseId) ?? 0n;
    const available = left.get(liturgy.houseId) ?? (start > 0n ? start : 0n);
    const levied = available < liturgy.due ? available : liturgy.due;
    left.set(liturgy.houseId, available - levied);
    return { ...liturgy, levied };
  });
}

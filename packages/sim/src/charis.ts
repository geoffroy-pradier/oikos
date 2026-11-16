/**
 * Charis (docs/specs/07-dieux-faveur-evenements.md, 7.1 ; #265) : ce qu'une offrande rapporte et ce que la
 * Charis d'une maison perd à chaque clôture, calculs purs en entiers. Le calcul est exact (entiers longs) :
 * un résultat au-delà des entiers sûrs est refusé plutôt qu'arrondi.
 */

/** Taux d'un dieu : Charis par obole offerte (nulle : il refuse la monnaie), et par unité de chaque bien. */
export interface CharisRates {
  charisPerObole: number;
  /** Un bien absent n'est pas accepté. */
  charisPerUnit: Readonly<Record<string, number>>;
}

export interface OfferingGifts {
  oboles: number;
  /** Chaque bien une fois. */
  goods: readonly { goodId: string; quantity: number }[];
}

export type OfferingCharis =
  | { ok: true; charis: number }
  | { ok: false; refused: { kind: 'oboles' } | { kind: 'good'; goodId: string } };

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const BPS = 10_000n;

const nonNegative = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative integer`);
};

/**
 * Charis que rapporte une offrande : oboles × taux par obole, plus, pour chaque bien, quantité × son taux.
 * Le dieu refuse toute l'offrande s'il n'accepte pas l'un de ses dons : de la monnaie à taux nul, ou un bien
 * sans taux. Une offrande vide ne rapporte rien. Le gain est additif : offrir en deux fois rapporte autant.
 */
export function offeringCharis(rates: CharisRates, gifts: OfferingGifts): OfferingCharis {
  nonNegative(rates.charisPerObole, 'charisPerObole');
  nonNegative(gifts.oboles, 'oboles');
  let total = 0n;
  if (gifts.oboles > 0) {
    if (rates.charisPerObole === 0) return { ok: false, refused: { kind: 'oboles' } };
    total += BigInt(gifts.oboles) * BigInt(rates.charisPerObole);
  }
  const seen = new Set<string>();
  for (const { goodId, quantity } of gifts.goods) {
    if (seen.has(goodId)) throw new RangeError(`good ${goodId} is offered twice`);
    seen.add(goodId);
    if (!Number.isSafeInteger(quantity) || quantity <= 0)
      throw new RangeError(`quantity of ${goodId} must be a positive integer`);
    const rate = Object.hasOwn(rates.charisPerUnit, goodId) ? rates.charisPerUnit[goodId] : 0;
    nonNegative(rate ?? 0, `charisPerUnit.${goodId}`);
    if (!rate) return { ok: false, refused: { kind: 'good', goodId } };
    total += BigInt(quantity) * BigInt(rate);
  }
  if (total > MAX)
    throw new RangeError('the Charis of this offering exceeds the safe integer range');
  return { ok: true, charis: Number(total) };
}

/**
 * Charis qu'une maison perd envers un dieu à une clôture : ⌊charis × déclin ÷ 10 000⌋, arrondie vers zéro.
 * Une Charis trop petite pour perdre une unité ne perd rien : avec 100 points de base, elle ne descend pas
 * sous 99 par le seul déclin.
 */
export function charisDecay(charis: number, dailyDecayBps: number): number {
  nonNegative(charis, 'charis');
  if (!Number.isSafeInteger(dailyDecayBps) || dailyDecayBps < 0 || dailyDecayBps > 10_000)
    throw new RangeError('dailyDecayBps must be an integer from 0 to 10 000');
  return Number((BigInt(charis) * BigInt(dailyDecayBps)) / BPS);
}

/**
 * Grâces (docs/specs/07-dieux-faveur-evenements.md, 7.1 ; #266) : ce qu'une grâce ajoute à l'action qui la
 * consomme, et quelle grâce en attente une action consomme. Calculs purs, en entiers. Une grâce ne retire jamais
 * rien : elle ajoute des unités à une récolte, ou raccourcit un trajet sans l'annuler.
 */
const BPS = 10_000;

export interface GraceStack {
  goodId: string;
  quantity: number;
}

const checkMagnitude = (magnitudeBps: number, max: number) => {
  if (!Number.isSafeInteger(magnitudeBps) || magnitudeBps < 0 || magnitudeBps > max)
    throw new RangeError(`Invalid grace magnitude ${magnitudeBps}`);
};

/**
 * Surplus d'une récolte bénie ou d'un atelier inspiré : pour chaque extrant récolté, ⌊quantité × ampleur ÷
 * 10 000⌋, arrondi vers le bas sur la quantité de toute la récolte (événements du monde compris). Un extrant
 * dont le surplus est nul n'y figure pas : une récolte d'une unité à 20 % ne rend rien de plus. Calcul exact en
 * entiers longs.
 */
export function graceSurplus(outputs: readonly GraceStack[], magnitudeBps: number): GraceStack[] {
  checkMagnitude(magnitudeBps, BPS);
  const surplus: GraceStack[] = [];
  for (const { goodId, quantity } of outputs) {
    if (!Number.isSafeInteger(quantity) || quantity < 0)
      throw new RangeError(`quantity of ${goodId} must be a non-negative integer`);
    const extra = Number((BigInt(quantity) * BigInt(magnitudeBps)) / BigInt(BPS));
    if (!Number.isSafeInteger(quantity + extra)) throw new RangeError('Yield is too large');
    if (extra > 0) surplus.push({ goodId, quantity: extra });
  }
  return surplus;
}

/**
 * Durée d'un trajet par vent favorable : ⌈secondes × (10 000 − ampleur) ÷ 10 000⌉, arrondie vers le haut comme
 * la durée elle-même. Ampleur au plus 5 000 : un trajet d'au moins une seconde en garde au moins une, et au
 * moins la moitié de sa durée. Appliquée après une tempête, sur la durée qu'elle a allongée.
 */
export function fairWindSeconds(seconds: number, magnitudeBps: number): number {
  if (!Number.isSafeInteger(seconds) || seconds < 0)
    throw new RangeError('seconds must be a non-negative integer');
  checkMagnitude(magnitudeBps, BPS / 2);
  return Number((BigInt(seconds) * BigInt(BPS - magnitudeBps) + BigInt(BPS - 1)) / BigInt(BPS));
}
/** Une invocation en attente de l'action qui la consommera. */
export interface PendingGrace {
  id: string;
  effect: string;
  invokedAt: Date;
}

/**
 * La grâce qu'une action consomme parmi celles en attente de la maison : la plus ancienne de l'effet de
 * l'action (à égalité d'instant, le plus petit identifiant), une seule, et seulement si elle ajoute quelque
 * chose (`adds`) ; sinon aucune, et toutes restent en attente.
 */
export function graceToConsume<T extends PendingGrace>(
  pending: readonly T[],
  effect: string,
  adds: (grace: T) => boolean,
): T | undefined {
  let oldest: T | undefined;
  for (const grace of pending) {
    if (grace.effect !== effect) continue;
    const gap = oldest ? grace.invokedAt.getTime() - oldest.invokedAt.getTime() : -1;
    if (!oldest || gap < 0 || (gap === 0 && grace.id < oldest.id)) oldest = grace;
  }
  return oldest && adds(oldest) ? oldest : undefined;
}

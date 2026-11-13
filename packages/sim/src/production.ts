/**
 * Production par évaluation paresseuse (docs/specs/13-moteur-anti-triche.md) : rien ne tourne en tâche de
 * fond. À la collecte, on compte les cycles de recette entièrement écoulés depuis le dernier horodatage.
 */
export interface AccrualInput {
  /** Début du cycle en cours lors de la dernière collecte. */
  since: Date;
  now: Date;
  /** Durée d'un cycle de la recette, en minutes. */
  cycleMinutes: number;
  /** Quantité produite par cycle. */
  outputPerCycle: number;
  /** Nombre maximal de cycles accumulés en l'absence du joueur (capacité de stockage du site). */
  maxCycles: number;
}

export interface Accrual {
  cycles: number;
  quantity: number;
  /** Nouveau début de cycle : le temps déjà écoulé dans le cycle en cours n'est jamais perdu. */
  since: Date;
}

const MINUTE_MS = 60_000;

export function accrueProduction({
  since,
  now,
  cycleMinutes,
  outputPerCycle,
  maxCycles,
}: AccrualInput): Accrual {
  for (const [name, value] of Object.entries({ cycleMinutes, outputPerCycle, maxCycles })) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError(`${name} must be a positive integer`);
  }
  if (Number.isNaN(since.getTime()) || Number.isNaN(now.getTime()))
    throw new RangeError('Invalid date');
  if (!Number.isSafeInteger(maxCycles * outputPerCycle))
    throw new RangeError('Site capacity is too large');
  const cycleMs = cycleMinutes * MINUTE_MS;
  const elapsed = Math.floor((now.getTime() - since.getTime()) / cycleMs);
  if (elapsed <= 0) return { cycles: 0, quantity: 0, since };
  // Dès que le site est plein, le temps entamé au-delà n'est pas conservé : un site plein ne produit plus.
  if (elapsed >= maxCycles) {
    // Site plein : la production s'est arrêtée. Un nouveau cycle commence à la collecte.
    return { cycles: maxCycles, quantity: maxCycles * outputPerCycle, since: now };
  }
  return {
    cycles: elapsed,
    quantity: elapsed * outputPerCycle,
    since: new Date(since.getTime() + elapsed * cycleMs),
  };
}

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

export interface WorkshopAccrualInput {
  since: Date;
  now: Date;
  cycleMinutes: number;
  maxCycles: number;
  /** Intrants de la recette : quantité consommée par cycle et quantité libre en stock. */
  inputs: readonly { perCycle: number; available: number }[];
}

export interface WorkshopAccrual {
  /** Cycles réalisés : bornés par le temps écoulé, par le plafond du site et par les intrants. */
  cycles: number;
  /** Cycles que le temps écoulé permettait, intrants mis à part (plafond du site compris). */
  elapsedCycles: number;
  since: Date;
}

/**
 * Production d'un atelier (docs/specs/04-systemes-gestion.md, 4.3). Un cycle ne tourne que si ses
 * intrants sont en stock. À court d'intrants, le cycle attend : le temps qu'il a attendu reste dû et se
 * rattrape à la collecte suivante, mais jamais au-delà du plafond d'accumulation du site.
 * Sans intrant, le résultat est celui de `accrueProduction`.
 */
export function accrueWorkshop({
  since,
  now,
  cycleMinutes,
  maxCycles,
  inputs,
}: WorkshopAccrualInput): WorkshopAccrual {
  for (const { perCycle, available } of inputs) {
    if (!Number.isSafeInteger(perCycle) || perCycle <= 0)
      throw new RangeError('perCycle must be a positive integer');
    if (!Number.isSafeInteger(available) || available < 0)
      throw new RangeError('available must be a non-negative integer');
  }
  const byTime = accrueProduction({ since, now, cycleMinutes, outputPerCycle: 1, maxCycles });
  const affordable = Math.min(
    ...inputs.map(({ perCycle, available }) => Math.floor(available / perCycle)),
  );
  const cycles = Math.min(byTime.cycles, affordable);
  if (cycles === byTime.cycles)
    return { cycles, elapsedCycles: byTime.cycles, since: byTime.since };
  // Cycles en attente d'intrants : leur temps reste dû, compté à rebours depuis l'horodatage que le
  // temps seul aurait donné (qui a déjà écarté ce qui dépasse le plafond).
  const owed = (byTime.cycles - cycles) * cycleMinutes * MINUTE_MS;
  return {
    cycles,
    elapsedCycles: byTime.cycles,
    since: new Date(byTime.since.getTime() - owed),
  };
}

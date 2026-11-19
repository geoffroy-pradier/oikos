/**
 * Choix de l'opération suivante d'un intendant (docs/specs/04-systemes-gestion.md, 4.4 ; #279), sans entrée-sortie.
 * Les règles sont celles de la grammaire fermée (`stewardRuleSchema`), déjà réduites aux premières que la
 * configuration admet.
 */
export type StewardPlanRule =
  | { kind: 'collect' }
  | { kind: 'sell'; goodId: string; minPriceOboles: number; keepUnits: number }
  | { kind: 'buy'; goodId: string; maxPriceOboles: number; targetUnits: number };

/** Ce que l'intendant voit du site et des stocks de sa maison dans la cité du site. */
export interface StewardSight {
  /** Au moins un cycle du site est écoulé : une récolte a de quoi être tentée. */
  collectable: boolean;
  /** Stock libre d'un bien (quantité moins réservé par les ventes en attente). */
  free(goodId: string): number;
  /** Stock d'un bien plus ce que les achats en attente de la maison doivent encore livrer. */
  incoming(goodId: string): number;
}

export type StewardAction =
  | { kind: 'collect' }
  | { kind: 'order'; side: 'sell' | 'buy'; goodId: string; price: number; quantity: number };

/** L'action qu'une règle demande maintenant, ou `null` si elle n'a rien à faire. */
export function ruleAction(
  rule: StewardPlanRule,
  sight: StewardSight,
  maxQuantity: number,
): StewardAction | null {
  switch (rule.kind) {
    case 'collect':
      return sight.collectable ? { kind: 'collect' } : null;
    case 'sell': {
      const surplus = sight.free(rule.goodId) - rule.keepUnits;
      if (surplus <= 0) return null;
      const quantity = Math.min(surplus, maxQuantity);
      return {
        kind: 'order',
        side: 'sell',
        goodId: rule.goodId,
        price: rule.minPriceOboles,
        quantity,
      };
    }
    case 'buy': {
      const missing = rule.targetUnits - sight.incoming(rule.goodId);
      if (missing <= 0) return null;
      const quantity = Math.min(missing, maxQuantity);
      return {
        kind: 'order',
        side: 'buy',
        goodId: rule.goodId,
        price: rule.maxPriceOboles,
        quantity,
      };
    }
  }
}

/**
 * Opération suivante : la première règle qui a quelque chose à faire, en partant de la position `start` et en
 * revenant au début de la liste (une file circulaire). L'appelant fait partir chaque opération de la règle qui
 * suit celle de l'opération précédente : une règle refusée à chaque tick ne retient pas les suivantes, et une
 * règle qui n'a rien à faire est passée sans compter. Une règle au repos (`resting`, positions refusées depuis
 * moins de `stewards.refusalRestTicks` ticks, #621) est passée de même. `null` : aucune règle n'a rien à faire.
 */
export function nextStewardOperation(
  rules: readonly StewardPlanRule[],
  start: number,
  sight: StewardSight,
  maxQuantity: number,
  resting: ReadonlySet<number> = new Set(),
): { position: number; action: StewardAction } | null {
  const count = rules.length;
  if (count === 0) return null;
  const first = ((Math.trunc(start) % count) + count) % count;
  for (let offset = 0; offset < count; offset += 1) {
    const position = (first + offset) % count;
    if (resting.has(position)) continue;
    const rule = rules[position];
    const action = rule && ruleAction(rule, sight, maxQuantity);
    if (action) return { position, action };
  }
  return null;
}

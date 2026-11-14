import type { CommandResponse } from './api';

export interface Stack {
  goodId: string;
  quantity: number;
}

export interface CollectAllOutcome {
  /** Ce qui a été engrangé, toutes récoltes réussies confondues, un total par bien. */
  collected: Stack[];
  /** Sites récoltés avec succès. */
  succeeded: string[];
  /** Sites dont la récolte a échoué, avec le code d'erreur de l'API. */
  failed: { siteId: string; code: string }[];
}

/**
 * « Tout récolter » : une commande `site.collect` par site, l'une après l'autre (une récolte d'atelier
 * consomme du stock dont dépend la suivante). Un échec n'arrête pas les autres récoltes ; chacun est
 * rapporté avec son site.
 */
export async function collectAll(
  siteIds: readonly string[],
  collect: (siteId: string) => Promise<CommandResponse<{ outputs: Stack[] }>>,
): Promise<CollectAllOutcome> {
  const totals = new Map<string, number>();
  const outcome: CollectAllOutcome = { collected: [], succeeded: [], failed: [] };
  for (const siteId of siteIds) {
    const result = await collect(siteId);
    if (!result.ok) {
      outcome.failed.push({ siteId, code: result.error.code });
      continue;
    }
    outcome.succeeded.push(siteId);
    for (const stack of result.data.outputs)
      totals.set(stack.goodId, (totals.get(stack.goodId) ?? 0) + stack.quantity);
  }
  outcome.collected = [...totals].map(([goodId, quantity]) => ({ goodId, quantity }));
  return outcome;
}

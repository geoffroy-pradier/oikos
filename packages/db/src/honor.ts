import { honorChangedSchema, type DomainEvent, type HonorReason } from '@oikos/contracts';
import { sql } from 'kysely';
import type { Db } from './index';

/** Ligne du journal de la Timè à écrire : sa maison, son motif, sa référence et son jour de jeu. */
export interface HonorMovement {
  worldId: string;
  houseId: string;
  reason: HonorReason;
  /** Ce qui la justifie (la charge d'un mandat, par exemple) : une ligne au plus par motif et par référence. */
  reference: string;
  gameDay: number;
  /** Commande qui l'écrit ; nulle pour la clôture. */
  commandId?: string | null;
  /**
   * Déclaration de l'événement d'une commande (`emit` de son contexte) : l'événement `HonorChanged` est alors
   * enregistré avec ceux de la commande, plutôt qu'écrit ici.
   */
  emit?: (event: DomainEvent) => void;
}

/**
 * Écrit une variation de la Timè d'une maison (docs/specs/04-systemes-gestion.md, 4.1 ; #704), seul chemin du
 * jeu vers `honor_ledger`. Sous le verrou consultatif `honor:<maison>` de la transaction, que tout écrivain prend,
 * la Timè est relue et `change` en tire la variation (`honorChange`, bornes de la configuration) : deux écritures
 * concurrentes ne la font pas sortir de ses bornes. Une variation nulle n'écrit rien ; une ligne déjà écrite pour ce
 * motif et cette référence (rejeu) non plus. Sinon, la ligne et l'événement `HonorChanged` sont écrits ensemble.
 * Plusieurs maisons dans une transaction : les écrire dans l'ordre de leurs identifiants.
 */
export async function recordHonorChange(
  trx: Db,
  movement: HonorMovement,
  change: (balance: number) => number,
): Promise<{ amount: number; balance: number } | null> {
  const { worldId, houseId, reason, reference, gameDay } = movement;
  await sql`select pg_advisory_xact_lock(hashtextextended(${`honor:${houseId}`}, 0))`.execute(trx);
  const row = await trx
    .selectFrom('game.honor')
    .select('honor')
    .where('house_id', '=', houseId)
    .executeTakeFirst();
  const before = Number(row?.honor ?? 0);
  const amount = change(before);
  if (!Number.isSafeInteger(amount)) throw new RangeError(`Invalid Timè change ${amount}`);
  if (amount === 0) return null;
  const written = await trx
    .insertInto('game.honor_ledger')
    .values({
      world_id: worldId,
      house_id: houseId,
      amount,
      reason,
      reference,
      game_day: gameDay,
    })
    .onConflict((conflict) => conflict.columns(['reason', 'reference']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!written) return null;
  const balance = before + amount;
  const event = honorChangedSchema.parse({
    type: 'HonorChanged',
    payload: { houseId, amount, reason, balance },
  });
  if (movement.emit) {
    movement.emit(event);
    return { amount, balance };
  }
  await trx
    .insertInto('game.domain_events')
    .values({
      command_id: movement.commandId ?? null,
      type: event.type,
      payload: JSON.stringify(event.payload),
    })
    .execute();
  return { amount, balance };
}

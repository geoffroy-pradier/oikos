import type { GameConfig } from '@oikos/config';
import type { CommandError, DomainEvent } from '@oikos/contracts';
import type { Db, GameDatabase } from '@oikos/db';
import type { SelectQueryBuilder } from 'kysely';

/** Issue d'une opération : ses données, ou un refus métier dont l'appelant annule les effets. */
export type OperationResult<T> = { ok: true; data: T } | { ok: false; error: CommandError };

/**
 * Ce que reçoit le cœur d'une opération de jeu, qu'elle vienne d'une commande du joueur (API) ou d'un intendant
 * (moteur, #279) : l'appelant ouvre la transaction, tient la clé d'idempotence, journalise et enregistre les
 * événements (ADR 0009).
 */
export interface OperationContext {
  /** Transaction de l'opération : toute écriture passe par elle. */
  trx: Db;
  /** Déclare un événement de domaine, enregistré par l'appelant si l'opération réussit. */
  emit(event: DomainEvent): void;
  /** Configuration en vigueur : seule source des valeurs d'équilibrage. */
  config: GameConfig;
  /** Instant de l'opération, lu sur l'horloge de la base (début de la transaction). */
  now: Date;
}

/**
 * Maison pour le compte de laquelle l'opération agit : celle du compte authentifié (commande du joueur), ou celle
 * que désigne son intendant (moteur), qui signe alors les ordres qu'il pose (`stewardId`, #562). Un site ou un ordre
 * d'une autre maison est indiscernable d'un inexistant.
 */
export type Actor = { userId: string } | { houseId: string; stewardId?: string };

/** Restreint une lecture de `game.houses` à la maison de l'acteur. */
export const houseOf = <O>(
  houses: SelectQueryBuilder<GameDatabase, 'game.houses', O>,
  actor: Actor,
) =>
  'userId' in actor
    ? houses.where('user_id', '=', actor.userId)
    : houses.where('id', '=', actor.houseId);

/** Une opération de jeu : son nom (celui de la commande du joueur) et son cœur transactionnel. */
export interface OperationDefinition<I, O> {
  name: string;
  /** Erreurs métier déduites d'une contrainte de la base, qui fait foi sous concurrence. */
  errorByConstraint?: Record<string, CommandError>;
  run(context: OperationContext, actor: Actor, input: I): Promise<OperationResult<O>>;
}

export const defineOperation = <I, O>(definition: OperationDefinition<I, O>) => definition;

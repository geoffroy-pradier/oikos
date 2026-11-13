import { domainEventSchema, type CommandError, type DomainEvent } from '@oikos/contracts';
import { violatedConstraint, type Db } from '@oikos/db';
import { sql } from 'kysely';
import type { z } from 'zod';

export type CommandResult<T> = { ok: true; data: T } | { ok: false; error: CommandError };

export interface CommandContext {
  /** Transaction de la commande : toute écriture passe par elle. */
  trx: Db;
  /** Compte authentifié, tiré du jeton, jamais de l'entrée. */
  userId: string;
  /** Déclare un événement de domaine, enregistré si la commande réussit. */
  emit(event: DomainEvent): void;
}

export interface CommandDefinition<I = unknown, O = unknown> {
  name: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  /** Codes d'erreur métier que la commande peut rendre (documentation du contrat). */
  errors: readonly string[];
  /** Erreurs métier déduites d'une contrainte de la base, qui fait foi sous concurrence. */
  errorByConstraint?: Record<string, CommandError>;
  handler(context: CommandContext, input: I): Promise<CommandResult<O>>;
}

export const defineCommand = <I, O>(definition: CommandDefinition<I, O>) => definition;

export interface CommandRequest {
  userId: string;
  idempotencyKey: string;
  input: unknown;
}

export interface CommandOutcome {
  response: CommandResult<unknown>;
  /** Vrai si la réponse vient du journal : la commande n'a pas été exécutée une seconde fois. */
  replayed: boolean;
}

const failure = (code: string, message: string, fields?: string[]): CommandResult<never> => ({
  ok: false,
  error: fields ? { code, message, fields } : { code, message },
});

/** Forme canonique d'une valeur JSON : clés triées. Postgres ne conserve pas l'ordre des clés d'un `jsonb`. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const sameJson = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** Entrée journalisée à la place d'une entrée que Postgres ne peut pas stocker. */
const UNSTORABLE_INPUT = '{"unstorable":true}';

/**
 * Texte JSON de l'entrée, ou `null` si elle ne peut pas être stockée en `jsonb` : caractère nul,
 * demi-paire de substitution isolée, imbrication trop profonde. Le journal doit pouvoir s'écrire
 * quelle que soit l'entrée reçue.
 */
export function storableJson(input: unknown): string | null {
  try {
    const text = JSON.stringify(input ?? null);
    return /\\u(0000|d[89a-f][0-9a-f]{2})/i.test(text) ? null : text;
  } catch {
    return null;
  }
}

/**
 * Exécute une commande : une transaction, une clé d'idempotence, une ligne de journal, des événements.
 * - Réussite : effets, événements et ligne `ok` sont validés ensemble.
 * - Erreur métier : les effets éventuels sont annulés, la ligne `rejected` est validée (la clé est consommée).
 * - Erreur inattendue : tout est annulé, une ligne `failed` sans clé est écrite à part (la clé reste utilisable).
 */
export async function executeCommand(
  db: Db,
  command: CommandDefinition,
  { userId, idempotencyKey, input }: CommandRequest,
): Promise<CommandOutcome> {
  const startedAt = performance.now();
  const duration = () => Math.round(performance.now() - startedAt);
  const storable = storableJson(input);
  const loggedInput = storable ?? UNSTORABLE_INPUT;
  const trx = await db.startTransaction().setIsolationLevel('read committed').execute();
  try {
    // Deux requêtes portant la même clé s'exécutent l'une après l'autre : la seconde rejoue la première.
    // (Suppose le niveau READ COMMITTED, fixé ci-dessus : la seconde doit voir la ligne validée par la première.)
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${idempotencyKey}`}, 0))`.execute(
      trx,
    );
    const previous = await trx
      .selectFrom('game.command_log')
      .select(['command', 'input', 'response'])
      .where('user_id', '=', userId)
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    if (previous) {
      await trx.rollback().execute();
      if (previous.command !== command.name || !sameJson(previous.input, JSON.parse(loggedInput))) {
        const message = 'This idempotency key was already used for another command or input.';
        return { response: failure('IDEMPOTENCY_KEY_REUSED', message), replayed: false };
      }
      return { response: previous.response as CommandResult<unknown>, replayed: true };
    }

    const events: DomainEvent[] = [];
    let response: CommandResult<unknown>;
    const parsed = command.input.safeParse(input);
    if (storable === null) {
      response = failure('VALIDATION_FAILED', 'Input cannot be stored.');
    } else if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
      response = failure('VALIDATION_FAILED', 'Invalid input.', fields);
    } else {
      const effects = await trx.savepoint('command').execute();
      try {
        response = await command.handler(
          { trx: effects, userId, emit: (event) => events.push(domainEventSchema.parse(event)) },
          parsed.data,
        );
        if (response.ok) response = { ok: true, data: command.output.parse(response.data) };
      } catch (error) {
        const mapped = command.errorByConstraint?.[violatedConstraint(error) ?? ''];
        if (!mapped) throw error;
        response = { ok: false, error: mapped };
      }
      // Une commande refusée ne laisse aucun effet, même si elle avait commencé à écrire.
      if (!response.ok) await effects.rollbackToSavepoint('command').execute();
    }

    const logged = await trx
      .insertInto('game.command_log')
      .values({
        user_id: userId,
        command: command.name,
        idempotency_key: idempotencyKey,
        input: loggedInput,
        status: response.ok ? 'ok' : 'rejected',
        error_code: response.ok ? null : response.error.code,
        response: JSON.stringify(response),
        duration_ms: duration(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (response.ok && events.length > 0) {
      await trx
        .insertInto('game.domain_events')
        .values(
          events.map((event) => ({
            command_id: logged.id,
            type: event.type,
            payload: JSON.stringify(event.payload),
          })),
        )
        .execute();
    }
    await trx.commit().execute();
    return { response, replayed: false };
  } catch (error) {
    if (!trx.isCommitted && !trx.isRolledBack) await trx.rollback().execute();
    console.error(`Command ${command.name} failed`, error);
    const response = failure('INTERNAL', 'Unexpected error.');
    // Trace d'audit hors transaction, sans clé : la commande pourra être retentée avec la même clé.
    await db
      .insertInto('game.command_log')
      .values({
        user_id: userId,
        command: command.name,
        idempotency_key: null,
        input: loggedInput,
        status: 'failed',
        error_code: 'INTERNAL',
        response: JSON.stringify(response),
        duration_ms: duration(),
      })
      .execute()
      .catch((logError: unknown) => console.error('Audit log write failed', logError));
    return { response, replayed: false };
  }
}

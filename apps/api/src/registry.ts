import { createHash } from 'node:crypto';
import type { GameConfig, LoadedConfig } from '@oikos/config';
import {
  domainEventSchema,
  type AdminRole,
  type CommandError,
  type DomainEvent,
} from '@oikos/contracts';
import { violatedConstraint, type Db, type GameDatabase } from '@oikos/db';
import { sql, type ControlledTransaction } from 'kysely';
import type { z } from 'zod';

export type CommandResult<T> = { ok: true; data: T } | { ok: false; error: CommandError };

export interface CommandContext {
  /** Transaction de la commande : toute écriture passe par elle. */
  trx: Db;
  /** Compte authentifié, tiré du jeton, jamais de l'entrée. */
  userId: string;
  /** Déclare un événement de domaine, enregistré si la commande réussit. */
  emit(event: DomainEvent): void;
  /** Configuration active à l'arrivée de la commande : seule source des valeurs d'équilibrage. */
  config: GameConfig;
  /** Instant de la commande, lu sur l'horloge de la base (début de la transaction). */
  now: Date;
  /** Rôle d'administration du compte, pour une commande d'administration ; `null` sinon. */
  adminRole: AdminRole | null;
  /** Réglages de l'API, tirés de son environnement au démarrage. */
  settings: ApiSettings;
}

export interface ApiSettings {
  /** Monde de test : l'auteur d'une version de configuration peut la programmer lui-même (15.2). */
  allowSelfReview: boolean;
}
/** Réglages par défaut : ceux de la production. */
export const DEFAULT_SETTINGS: ApiSettings = { allowSelfReview: false };

/** Charge la configuration active à un instant (`createConfigLoader(db).at`). */
export type ConfigSource = (at: Date) => Promise<LoadedConfig>;

export interface CommandDefinition<I = unknown, O = unknown> {
  name: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  /** Codes d'erreur métier que la commande peut rendre (documentation du contrat). */
  errors: readonly string[];
  /**
   * Commande d'administration : rôles autorisés. Le compte doit porter l'un d'eux dans `admin.roles` et
   * sa session avoir passé la double authentification, sinon `FORBIDDEN` (refus journalisé).
   */
  admin?: readonly AdminRole[];
  /** Erreurs métier déduites d'une contrainte de la base, qui fait foi sous concurrence. */
  errorByConstraint?: Record<string, CommandError>;
  handler(context: CommandContext, input: I): Promise<CommandResult<O>>;
}

export const defineCommand = <I, O>(definition: CommandDefinition<I, O>) => definition;

export interface CommandRequest {
  userId: string;
  /** Niveau d'assurance de la session ; absent : session simple. */
  aal?: 'aal1' | 'aal2';
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
  { userId, aal, idempotencyKey, input }: CommandRequest,
  loadConfig: ConfigSource,
  settings: ApiSettings = DEFAULT_SETTINGS,
): Promise<CommandOutcome> {
  const startedAt = performance.now();
  const duration = () => Math.round(performance.now() - startedAt);
  const storable = storableJson(input);
  const loggedInput = storable ?? UNSTORABLE_INPUT;
  // Entrée d'une commande d'administration refusée ou en panne avant le contrôle du rôle : le journal n'en
  // garde que la taille et l'empreinte. Sans cela, un compte sans rôle remplirait le journal (en ajout
  // seul) avec des corps de la taille d'une configuration.
  const redactedInput = JSON.stringify({
    redacted: true,
    bytes: Buffer.byteLength(loggedInput),
    sha256: createHash('sha256').update(loggedInput).digest('hex'),
  });
  let authorized = !command.admin;
  let trx: ControlledTransaction<GameDatabase> | undefined;
  // Contexte porté au journal, que la commande réussisse, soit refusée ou tombe en panne.
  const context: {
    aal: 'aal1' | 'aal2';
    admin_role: string | null;
    config_version_id: string | null;
  } = { aal: aal ?? 'aal1', admin_role: null, config_version_id: null };
  try {
    // Chargée avant la transaction : le chargeur lit par le pool, jamais pendant qu'on tient une connexion.
    const { config, id: configVersionId } = await loadConfig(new Date());
    context.config_version_id = configVersionId;
    trx = await db.startTransaction().setIsolationLevel('read committed').execute();
    // Deux requêtes portant la même clé s'exécutent l'une après l'autre : la seconde rejoue la première.
    // (Suppose le niveau READ COMMITTED, fixé ci-dessus : la seconde doit voir la ligne validée par la première.)
    const clock = await sql<{ now: Date }>`
      select now() as now, pg_advisory_xact_lock(hashtextextended(${`${userId}:${idempotencyKey}`}, 0))
    `.execute(trx);
    const now = clock.rows[0]?.now;
    if (!now) throw new Error('The database returned no clock');
    const previous = await trx
      .selectFrom('game.command_log')
      .select(['command', 'input', 'response'])
      .where('user_id', '=', userId)
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    if (previous) {
      await trx.rollback().execute();
      const sameInput = [loggedInput, redactedInput].some((text) =>
        sameJson(previous.input, JSON.parse(text)),
      );
      if (previous.command !== command.name || !sameInput) {
        const message = 'This idempotency key was already used for another command or input.';
        return { response: failure('IDEMPOTENCY_KEY_REUSED', message), replayed: false };
      }
      return { response: previous.response as CommandResult<unknown>, replayed: true };
    }

    const events: DomainEvent[] = [];
    let response: CommandResult<unknown>;
    const parsed = command.input.safeParse(input);
    // Le rôle est relu en base à chaque commande : un rôle retiré cesse d'agir immédiatement.
    const adminRole = command.admin
      ? ((
          await trx
            .selectFrom('admin.roles')
            .select('role')
            .where('user_id', '=', userId)
            .executeTakeFirst()
        )?.role ?? null)
      : null;
    context.admin_role = adminRole;
    if (command.admin && (aal !== 'aal2' || !adminRole || !command.admin.includes(adminRole))) {
      response = failure('FORBIDDEN', 'Administrator role and two-factor session required.');
    } else if (((authorized = true), storable === null)) {
      response = failure('VALIDATION_FAILED', 'Input cannot be stored.');
    } else if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
      response = failure('VALIDATION_FAILED', 'Invalid input.', fields);
    } else {
      const effects = await trx.savepoint('command').execute();
      try {
        response = await command.handler(
          {
            trx: effects,
            userId,
            emit: (event) => events.push(domainEventSchema.parse(event)),
            config,
            now,
            adminRole,
            settings,
          },
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
        input: authorized ? loggedInput : redactedInput,
        status: response.ok ? 'ok' : 'rejected',
        error_code: response.ok ? null : response.error.code,
        response: JSON.stringify(response),
        duration_ms: duration(),
        ...context,
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
    // Sur une connexion morte (session fermée par la base), l'annulation échoue à son tour : la base a
    // déjà tout annulé. Ce second échec ne doit pas empêcher la réponse ni la trace d'audit.
    if (trx && !trx.isCommitted && !trx.isRolledBack)
      await trx
        .rollback()
        .execute()
        .catch((rollbackError: unknown) =>
          console.error(`Command ${command.name}: rollback failed`, rollbackError),
        );
    console.error(`Command ${command.name} failed`, error);
    const response = failure('INTERNAL', 'Unexpected error.');
    // Trace d'audit hors transaction, sans clé : la commande pourra être retentée avec la même clé.
    await db
      .insertInto('game.command_log')
      .values({
        user_id: userId,
        command: command.name,
        idempotency_key: null,
        input: authorized ? loggedInput : redactedInput,
        status: 'failed',
        error_code: 'INTERNAL',
        response: JSON.stringify(response),
        duration_ms: duration(),
        ...context,
      })
      .execute()
      .catch((logError: unknown) => console.error('Audit log write failed', logError));
    return { response, replayed: false };
  }
}

import { publishVersion, scheduleActivation, validateConfig, type GameConfig } from '@oikos/config';
import {
  ADMIN_CANCEL_ACTIVATION_ERROR_CODES,
  ADMIN_PUBLISH_CONFIG_ERROR_CODES,
  ADMIN_SCHEDULE_CONFIG_ERROR_CODES,
  adminCancelActivationInputSchema,
  adminCancelActivationOutputSchema,
  adminPublishConfigInputSchema,
  adminPublishConfigOutputSchema,
  adminScheduleConfigInputSchema,
  adminScheduleConfigOutputSchema,
  CONFIG_EDITOR_ROLES,
} from '@oikos/contracts';
import { nextDailyClose } from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand } from '../registry';

/**
 * L'horloge d'un monde ne change pas (#123). L'indice d'un tick se compte en durées de tick depuis
 * l'origine : changer la durée changerait l'échelle des indices déjà joués et bloquerait le monde. Changer
 * l'heure ou le fuseau de clôture déplacerait le jour de jeu d'une version programmée « à la prochaine
 * clôture » : elle entrerait en vigueur à l'ancienne heure, et la clôture de ce jour la lirait ou non selon
 * le sens du changement. Rend les champs d'horloge qui diffèrent de la version en vigueur.
 */
const clockChanges = (next: GameConfig['clock'], current: GameConfig['clock']) =>
  (['tickMinutes', 'dailyCloseHour', 'timezone'] as const).filter(
    (key) => next[key] !== current[key],
  );
const clockChanged = (fields: readonly string[]) => ({
  ok: false as const,
  error: {
    code: 'CONFIG_CLOCK_CHANGED',
    message: 'The world clock (tick duration, close hour, timezone) cannot change.',
    fields: fields.map((key) => `clock.${key}`),
  },
});

/**
 * Enregistre une nouvelle version de configuration (docs/specs/15-back-office-olympe.md, 15.2).
 * La version est immuable et n'est pas active : il faut la programmer par `admin.scheduleConfig`.
 */
export const adminPublishConfig = defineCommand({
  name: 'admin.publishConfig',
  admin: CONFIG_EDITOR_ROLES,
  input: adminPublishConfigInputSchema,
  output: adminPublishConfigOutputSchema,
  errors: ADMIN_PUBLISH_CONFIG_ERROR_CODES,
  async handler({ trx, userId, emit, config }, input) {
    // L'horloge ne change pas (#123) : refusé à la publication comme à la programmation.
    const parsed = validateConfig(input.config);
    const changed = parsed.ok ? clockChanges(parsed.config.clock, config.clock) : [];
    if (changed.length > 0) return clockChanged(changed);
    const published = await publishVersion(trx, input.config, {
      note: input.note,
      createdBy: userId,
    });
    if (!published.ok) {
      return {
        ok: false,
        error: {
          code: 'CONFIG_INVALID',
          message: 'The configuration does not match the schema.',
          fields: published.errors,
        },
      };
    }
    const { id: versionId, number } = published.version;
    emit({ type: 'ConfigVersionPublished', payload: { versionId, number, publishedBy: userId } });
    return { ok: true, data: { versionId, number } };
  },
});

/**
 * Variable d'environnement de l'API qui lève la revue par une seconde personne. Réservée à un monde de
 * test tenu par une seule personne : désactivée par défaut, seule la valeur exacte `true` l'active.
 */
export const SELF_REVIEW_ENV = 'OLYMPE_ALLOW_SELF_REVIEW';
export const selfReviewFromEnv = (env: Record<string, string | undefined>) =>
  env[SELF_REVIEW_ENV] === 'true';

/**
 * Programme l'activation d'une version à la prochaine clôture quotidienne, calculée avec l'horloge de la
 * configuration en vigueur. Programmer une version antérieure, c'est revenir en arrière.
 * Double validation (15.2, étape 3) : l'auteur d'une version ne la programme pas lui-même, à moins qu'un
 * autre compte ne l'ait déjà programmée (elle a été revue) ou que le réglage `allowSelfReview` lève la règle.
 */
export const adminScheduleConfig = defineCommand({
  name: 'admin.scheduleConfig',
  admin: CONFIG_EDITOR_ROLES,
  input: adminScheduleConfigInputSchema,
  output: adminScheduleConfigOutputSchema,
  errors: ADMIN_SCHEDULE_CONFIG_ERROR_CODES,
  // Refus de la base, à l'inscription ou à la validation : la clôture visée est trop proche, ou passée.
  errorByConstraint: {
    activations_scheduled_ahead: {
      code: 'CONFIG_ACTIVATION_TOO_LATE',
      message:
        'The next close is less than a minute away, or passed before the scheduling was committed.',
    },
    activations_not_backdated: {
      code: 'CONFIG_ACTIVATION_TOO_LATE',
      message: 'The next close has already passed.',
    },
  },
  async handler({ trx, userId, emit, config, now, settings }, input) {
    // Même borne que l'annulation : après l'inscription (journal, événements, validation), la transaction
    // reste bien en deçà de la marge d'une minute. La base contrôle de toute façon l'échéance à la validation.
    await sql`set local statement_timeout = '10s'`.execute(trx);
    const version = await trx
      .selectFrom('config.versions')
      .select(['id', 'payload'])
      // Comparé par la base, en `uuid` : pas de comparaison de chaînes (casse, forme) côté API.
      .select(sql<boolean>`created_by = ${userId}::uuid`.as('own'))
      .where('id', '=', input.versionId)
      .executeTakeFirst();
    if (!version) {
      return {
        ok: false,
        error: { code: 'CONFIG_VERSION_NOT_FOUND', message: 'Unknown configuration version.' },
      };
    }
    if (!settings.allowSelfReview && version.own) {
      const reviewed = await trx
        .selectFrom('config.activations')
        .select('id')
        .where('version_id', '=', version.id)
        .where('created_by', 'is not', null)
        .where('created_by', '<>', userId)
        .limit(1)
        .executeTakeFirst();
      if (!reviewed) {
        return {
          ok: false,
          error: {
            code: 'CONFIG_REVIEW_REQUIRED',
            message: 'A version is scheduled by an account other than its author.',
          },
        };
      }
    }
    // Une version écrite hors de `admin.publishConfig`, ou devenue invalide après un changement de schéma,
    // ne doit jamais entrer en vigueur : le chargeur la refuserait, et plus aucune commande ne passerait.
    const stored = validateConfig(version.payload);
    if (!stored.ok) {
      return {
        ok: false,
        error: {
          code: 'CONFIG_INVALID',
          message: 'The stored configuration no longer matches the schema.',
          fields: stored.errors,
        },
      };
    }
    const changed = clockChanges(stored.config.clock, config.clock);
    if (changed.length > 0) return clockChanged(changed);
    const activateAt = nextDailyClose(now, config.clock);
    await scheduleActivation(trx, version.id, activateAt, userId);
    const payload = { versionId: version.id, activateAt: activateAt.toISOString() };
    emit({ type: 'ConfigActivationScheduled', payload: { ...payload, scheduledBy: userId } });
    return { ok: true, data: payload };
  },
});

/**
 * Annule une programmation à venir, et avec elle toutes celles encore en attente pour la même clôture :
 * la version en vigueur le reste. Le journal des activations est en ajout seul, chaque annulation est une
 * ligne de plus, que `config.active_version_at` prend en compte. La base tranche : une seule annulation
 * par programmation, et plus aucune à moins d'une minute de l'échéance.
 */
export const adminCancelActivation = defineCommand({
  name: 'admin.cancelActivation',
  admin: CONFIG_EDITOR_ROLES,
  input: adminCancelActivationInputSchema,
  output: adminCancelActivationOutputSchema,
  errors: ADMIN_CANCEL_ACTIVATION_ERROR_CODES,
  errorByConstraint: {
    activation_cancellations_pkey: {
      code: 'CONFIG_ACTIVATION_CANCELLED',
      message: 'This activation is already cancelled.',
    },
    activation_cancellations_before_activation: {
      code: 'CONFIG_ACTIVATION_PAST',
      message: 'An activation in force, or due in less than a minute, cannot be cancelled.',
    },
  },
  async handler({ trx, userId, emit }, { activationId }) {
    // La base refuse l'annulation à moins d'une minute de l'échéance, puis la contrôle de nouveau à la
    // validation : une annulation validée après l'entrée en vigueur est refusée (CONFIG_ACTIVATION_PAST).
    // Chaque instruction est en plus bornée à dix secondes : une instruction trop longue est abandonnée
    // par Postgres, la connexion reste ouverte, la commande échoue comme toute autre panne, tracée.
    await sql`set local statement_timeout = '10s'`.execute(trx);
    const activation = await trx
      .selectFrom('config.activations')
      .select(['version_id', 'activate_at'])
      .where('id', '=', activationId)
      .executeTakeFirst();
    if (!activation) {
      return {
        ok: false,
        error: { code: 'CONFIG_ACTIVATION_NOT_FOUND', message: 'Unknown activation.' },
      };
    }
    // Une annulation à la fois : deux annulations visant la même clôture ne s'attendent pas l'une l'autre.
    await sql`select pg_advisory_xact_lock(hashtext('config.activation_cancellations'))`.execute(
      trx,
    );
    // Les autres programmations encore en attente pour la même clôture sont annulées avec elle.
    const others = await trx
      .selectFrom('config.activations as a')
      .select(['a.id as activationId', 'a.version_id as versionId'])
      .where('a.activate_at', '=', activation.activate_at)
      .where('a.id', '<>', activationId)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('config.activation_cancellations as c')
              .select('c.activation_id')
              .whereRef('c.activation_id', '=', 'a.id'),
          ),
        ),
      )
      .orderBy('a.seq', 'desc')
      .execute();
    // La programmation désignée en premier : déjà annulée ou trop proche de l'échéance, la base refuse.
    const cancelled = [{ activationId, versionId: activation.version_id }, ...others];
    await trx
      .insertInto('config.activation_cancellations')
      .values(
        cancelled.map((entry) => ({ activation_id: entry.activationId, cancelled_by: userId })),
      )
      .execute();
    const activateAt = activation.activate_at.toISOString();
    for (const entry of cancelled) {
      emit({
        type: 'ConfigActivationCancelled',
        payload: { ...entry, activateAt, cancelledBy: userId },
      });
    }
    return {
      ok: true,
      data: { activationId, versionId: activation.version_id, activateAt, cancelled },
    };
  },
});

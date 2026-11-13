import { publishVersion, scheduleActivation, validateConfig } from '@oikos/config';
import {
  ADMIN_PUBLISH_CONFIG_ERROR_CODES,
  ADMIN_SCHEDULE_CONFIG_ERROR_CODES,
  adminPublishConfigInputSchema,
  adminPublishConfigOutputSchema,
  adminScheduleConfigInputSchema,
  adminScheduleConfigOutputSchema,
  CONFIG_EDITOR_ROLES,
} from '@oikos/contracts';
import { nextDailyClose } from '@oikos/sim';
import { defineCommand } from '../registry';

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
  async handler({ trx, userId, emit }, input) {
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
 * Programme l'activation d'une version à la prochaine clôture quotidienne, calculée avec l'horloge de la
 * configuration en vigueur. Programmer une version antérieure, c'est revenir en arrière.
 */
export const adminScheduleConfig = defineCommand({
  name: 'admin.scheduleConfig',
  admin: CONFIG_EDITOR_ROLES,
  input: adminScheduleConfigInputSchema,
  output: adminScheduleConfigOutputSchema,
  errors: ADMIN_SCHEDULE_CONFIG_ERROR_CODES,
  async handler({ trx, userId, emit, config, now }, input) {
    const version = await trx
      .selectFrom('config.versions')
      .select(['id', 'payload'])
      .where('id', '=', input.versionId)
      .executeTakeFirst();
    if (!version) {
      return {
        ok: false,
        error: { code: 'CONFIG_VERSION_NOT_FOUND', message: 'Unknown configuration version.' },
      };
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
    const activateAt = nextDailyClose(now, config.clock);
    await scheduleActivation(trx, version.id, activateAt, userId);
    const payload = { versionId: version.id, activateAt: activateAt.toISOString() };
    emit({ type: 'ConfigActivationScheduled', payload: { ...payload, scheduledBy: userId } });
    return { ok: true, data: payload };
  },
});

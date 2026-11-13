import { z } from 'zod';

/** Rôles du back-office (docs/specs/15-back-office-olympe.md, 15.3). Un compte en porte au plus un. */
export const ADMIN_ROLES = [
  'super_admin',
  'game_designer',
  'community_manager',
  'moderator',
  'support',
  'observer',
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Rôles qui peuvent modifier les paramètres d'équilibrage. */
export const CONFIG_EDITOR_ROLES = ['super_admin', 'game_designer'] as const satisfies AdminRole[];

/** Commande `admin.publishConfig` : enregistre une nouvelle version de configuration, sans l'activer. */
export const adminPublishConfigInputSchema = z.strictObject({
  /** Configuration complète candidate ; validée par le schéma de `packages/config`. */
  config: z.record(z.string(), z.unknown()),
  note: z.string().trim().max(200).default(''),
});
export type AdminPublishConfigInput = z.input<typeof adminPublishConfigInputSchema>;
export const adminPublishConfigOutputSchema = z.object({
  versionId: z.uuid(),
  number: z.number().int().positive(),
});
export type AdminPublishConfigOutput = z.infer<typeof adminPublishConfigOutputSchema>;
export const ADMIN_PUBLISH_CONFIG_ERROR_CODES = ['FORBIDDEN', 'CONFIG_INVALID'] as const;

/**
 * Commande `admin.scheduleConfig` : programme l'activation d'une version à la prochaine clôture
 * quotidienne. Un retour arrière est la programmation d'une version antérieure.
 */
export const adminScheduleConfigInputSchema = z.strictObject({ versionId: z.uuid() });
export type AdminScheduleConfigInput = z.infer<typeof adminScheduleConfigInputSchema>;
export const adminScheduleConfigOutputSchema = z.object({
  versionId: z.uuid(),
  /** Instant de la clôture à laquelle la version entrera en vigueur (ISO 8601). */
  activateAt: z.iso.datetime(),
});
export type AdminScheduleConfigOutput = z.infer<typeof adminScheduleConfigOutputSchema>;
export const ADMIN_SCHEDULE_CONFIG_ERROR_CODES = [
  'FORBIDDEN',
  'CONFIG_VERSION_NOT_FOUND',
  'CONFIG_INVALID',
] as const;

export const configVersionPublishedSchema = z.strictObject({
  type: z.literal('ConfigVersionPublished'),
  payload: z.strictObject({
    versionId: z.uuid(),
    number: z.number().int().positive(),
    publishedBy: z.uuid(),
  }),
});

export const configActivationScheduledSchema = z.strictObject({
  type: z.literal('ConfigActivationScheduled'),
  payload: z.strictObject({
    versionId: z.uuid(),
    activateAt: z.iso.datetime(),
    scheduledBy: z.uuid(),
  }),
});

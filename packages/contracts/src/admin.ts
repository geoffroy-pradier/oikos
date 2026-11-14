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

/** Rôles qui gèrent les rôles des autres comptes (15.3). */
export const ROLE_MANAGER_ROLES = ['super_admin'] as const satisfies AdminRole[];
const adminRoleSchema = z.enum(ADMIN_ROLES);

/**
 * Commande `admin.grantRole` : accorde un rôle à un compte, ou remplace celui qu'il porte (un seul rôle
 * par compte). Le compte est désigné par son identifiant, jamais par une adresse : le journal n'en garde aucune.
 */
export const adminGrantRoleInputSchema = z.strictObject({
  userId: z.uuid(),
  role: adminRoleSchema,
});
export type AdminGrantRoleInput = z.infer<typeof adminGrantRoleInputSchema>;
export const adminGrantRoleOutputSchema = z.object({
  userId: z.uuid(),
  role: adminRoleSchema,
  /** Rôle remplacé ; `null` si le compte n'en portait aucun. */
  previousRole: adminRoleSchema.nullable(),
});
export type AdminGrantRoleOutput = z.infer<typeof adminGrantRoleOutputSchema>;
export const ADMIN_GRANT_ROLE_ERROR_CODES = [
  'FORBIDDEN',
  'ACCOUNT_NOT_FOUND',
  /** Le compte porte déjà ce rôle. */
  'ROLE_UNCHANGED',
  /** On ne change pas son propre rôle : un autre super-administrateur le fait. */
  'ROLE_SELF_GRANT',
  'LAST_SUPER_ADMIN',
] as const;

/** Commande `admin.revokeRole` : retire son rôle à un compte, qui perd aussitôt tout accès à Olympe. */
export const adminRevokeRoleInputSchema = z.strictObject({ userId: z.uuid() });
export type AdminRevokeRoleInput = z.infer<typeof adminRevokeRoleInputSchema>;
export const adminRevokeRoleOutputSchema = z.object({
  userId: z.uuid(),
  previousRole: adminRoleSchema,
});
export type AdminRevokeRoleOutput = z.infer<typeof adminRevokeRoleOutputSchema>;
export const ADMIN_REVOKE_ROLE_ERROR_CODES = [
  'FORBIDDEN',
  'ACCOUNT_NOT_FOUND',
  /** Le compte ne porte aucun rôle. */
  'ROLE_NOT_FOUND',
  /** Il doit toujours rester un super-administrateur. */
  'LAST_SUPER_ADMIN',
] as const;

export const adminRoleGrantedSchema = z.strictObject({
  type: z.literal('AdminRoleGranted'),
  payload: z.strictObject({
    userId: z.uuid(),
    role: adminRoleSchema,
    previousRole: adminRoleSchema.nullable(),
    grantedBy: z.uuid(),
  }),
});

export const adminRoleRevokedSchema = z.strictObject({
  type: z.literal('AdminRoleRevoked'),
  payload: z.strictObject({ userId: z.uuid(), previousRole: adminRoleSchema, revokedBy: z.uuid() }),
});

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

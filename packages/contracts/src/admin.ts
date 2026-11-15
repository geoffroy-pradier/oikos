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
export const ADMIN_PUBLISH_CONFIG_ERROR_CODES = [
  'FORBIDDEN',
  'CONFIG_INVALID',
  /** La version change l'horloge (durée du tick, heure ou fuseau de clôture) : refusé (#123). */
  'CONFIG_CLOCK_CHANGED',
] as const;

/**
 * Commande `admin.scheduleConfig` : programme l'activation d'une version à la prochaine clôture
 * quotidienne. Un retour arrière est la programmation d'une version antérieure.
 * Revue par une seconde personne (15.2, étape 3) : l'auteur d'une version ne la programme pas lui-même,
 * sauf si un autre compte l'a déjà programmée une fois (retour arrière vers une version déjà revue).
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
  /** La version attend sa revue : un autre compte que son auteur doit la programmer. */
  'CONFIG_REVIEW_REQUIRED',
  'CONFIG_INVALID',
  'CONFIG_CLOCK_CHANGED',
  /** La prochaine clôture tombe dans moins d'une minute, ou elle est passée avant la validation. */
  'CONFIG_ACTIVATION_TOO_LATE',
] as const;

/**
 * Commande `admin.cancelActivation` : annule une programmation à venir, et avec elle celles encore en
 * attente pour la même clôture. Les versions restent enregistrées et se reprogramment ; une activation en
 * vigueur, ou à moins d'une minute de son échéance, ne s'annule pas : on programme un retour arrière.
 */
export const adminCancelActivationInputSchema = z.strictObject({ activationId: z.uuid() });
export type AdminCancelActivationInput = z.infer<typeof adminCancelActivationInputSchema>;
export const adminCancelActivationOutputSchema = z.object({
  activationId: z.uuid(),
  versionId: z.uuid(),
  /** Clôture à laquelle la version serait entrée en vigueur (ISO 8601). */
  activateAt: z.iso.datetime(),
  /** Toutes les programmations annulées pour cette clôture, celle désignée en premier. */
  cancelled: z.array(z.object({ activationId: z.uuid(), versionId: z.uuid() })).min(1),
});
export type AdminCancelActivationOutput = z.infer<typeof adminCancelActivationOutputSchema>;
export const ADMIN_CANCEL_ACTIVATION_ERROR_CODES = [
  'FORBIDDEN',
  'CONFIG_ACTIVATION_NOT_FOUND',
  'CONFIG_ACTIVATION_CANCELLED',
  /** L'échéance est passée, ou dans moins d'une minute. */
  'CONFIG_ACTIVATION_PAST',
] as const;

export const configActivationCancelledSchema = z.strictObject({
  type: z.literal('ConfigActivationCancelled'),
  payload: z.strictObject({
    activationId: z.uuid(),
    versionId: z.uuid(),
    activateAt: z.iso.datetime(),
    cancelledBy: z.uuid(),
  }),
});

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

const oboles = z.number().int();
const bps = z.number().int();
/**
 * Lecture `GET /api/admin/economy` (docs/specs/05-economie.md, 5.5) : un bloc par monde, montants en
 * oboles entières, tirés du grand livre ; indice des prix tiré des chandeliers.
 */
export const adminEconomySchema = z.object({
  /** Nombre de jours de jeu détaillés dans `days`, jour en cours compris. */
  windowDays: z.number().int().positive(),
  /** Mesure de l'inflation : durée d'une fenêtre de prix en jours, cible en points de base (bornes comprises). */
  priceWindowDays: z.number().int().positive(),
  inflationTargetBps: z.object({ min: bps, max: bps }),
  worlds: z.array(
    z.object({
      worldId: z.uuid(),
      slug: z.string(),
      /** Masse monétaire : trésoreries des maisons, séquestres, trésors des cités, autres comptes. */
      moneySupply: z.object({
        total: oboles,
        houses: oboles,
        escrow: oboles,
        cityTreasuries: oboles,
        other: oboles,
      }),
      /**
       * Robinets et puits. `total` : monnaie créée (robinet) ou détruite (puits) depuis l'origine, en net ;
       * `days` : la même mesure par jour de jeu sur la fenêtre, jours sans mouvement omis.
       */
      systemAccounts: z.array(
        z.object({
          key: z.string(),
          kind: z.enum(['faucet', 'sink']),
          total: oboles,
          days: z.array(z.object({ gameDay: z.number().int(), amount: oboles })),
        }),
      ),
      /**
       * Indice du panier de référence (10 000 : prix de référence) sur la fenêtre courante et sur la
       * précédente, et inflation de l'une à l'autre. `null` : inconnu, faute d'échanges ou de panier.
       */
      priceIndex: z.object({
        currentBps: bps.nullable(),
        previousBps: bps.nullable(),
        inflationBps: bps.nullable(),
        status: z.enum(['in_target', 'below', 'above', 'unknown']),
        /** Biens du panier sans échange sur l'une des deux fenêtres. */
        unpricedGoods: z.array(z.string()),
      }),
    }),
  ),
});
export type AdminEconomy = z.infer<typeof adminEconomySchema>;

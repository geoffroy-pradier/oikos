import { z } from 'zod';
import type { AdminRole } from './admin';
import { CONTROL_CHARACTERS } from './chat';

/**
 * Commandes d'administration de la modération (docs/specs/15-back-office-olympe.md, 15.1, 15.3, 15.4 ; #276).
 * Ouvertes au super-administrateur, au responsable communauté et au modérateur, qui peut être un joueur bénévole :
 * aucune ne lit ni ne rend une donnée économique.
 */
export const MODERATION_ROLES = [
  'super_admin',
  'community_manager',
  'moderator',
] as const satisfies AdminRole[];

/** Plafond technique du motif d'une sanction, en caractères : celui de la base (`sanctions_reason_length`). */
export const SANCTION_REASON_MAX_CHARS = 2_000;
/** Motif d'une sanction, lu par le compte sanctionné : mêmes règles qu'un message (6.6), plafond de la base. */
export const sanctionReasonSchema = z
  .string()
  .trim()
  .min(1)
  .refine((text) => [...text].length <= SANCTION_REASON_MAX_CHARS, {
    message: `at most ${SANCTION_REASON_MAX_CHARS} characters`,
  })
  .refine((text) => !CONTROL_CHARACTERS.test(text), { message: 'control characters' });

/**
 * Commande `admin.sanction` : sanctionne un compte, désigné par son identifiant, à partir de maintenant. Un
 * avertissement, un silence et une suspension durent l'une des durées de la configuration
 * (`moderation.sanctionHours`) ; une exclusion n'a pas de durée et n'est que proposée, jusqu'à sa validation par
 * un autre compte (`admin.confirmExclusion`).
 */
export const adminSanctionInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    userId: z.uuid(),
    kind: z.enum(['warning', 'silence', 'suspension']),
    hours: z.number().int().positive(),
    reason: sanctionReasonSchema,
  }),
  z.strictObject({ userId: z.uuid(), kind: z.literal('ban'), reason: sanctionReasonSchema }),
]);
export type AdminSanctionInput = z.infer<typeof adminSanctionInputSchema>;
export const adminSanctionOutputSchema = z.object({
  sanctionId: z.uuid(),
  kind: z.enum(['warning', 'silence', 'suspension', 'ban']),
  startsAt: z.iso.datetime(),
  /** Nulle pour une exclusion. */
  endsAt: z.iso.datetime().nullable(),
  /** Exclusion à valider par un autre compte : elle n'agit pas encore. */
  pending: z.boolean(),
});
export type AdminSanctionOutput = z.infer<typeof adminSanctionOutputSchema>;
export const ADMIN_SANCTION_ERROR_CODES = [
  'FORBIDDEN',
  'ACCOUNT_NOT_FOUND',
  /** Durée absente de `moderation.sanctionHours` pour cette sorte de sanction. */
  'DURATION_NOT_OFFERED',
  /** Nul ne se sanctionne lui-même. */
  'SELF_SANCTION',
] as const;

/** Commande `admin.confirmExclusion` : un autre compte que l'auteur valide une exclusion, qui commence alors. */
export const adminConfirmExclusionInputSchema = z.strictObject({ sanctionId: z.uuid() });
export type AdminConfirmExclusionInput = z.infer<typeof adminConfirmExclusionInputSchema>;
export const adminConfirmExclusionOutputSchema = z.object({
  sanctionId: z.uuid(),
  startsAt: z.iso.datetime(),
});
export type AdminConfirmExclusionOutput = z.infer<typeof adminConfirmExclusionOutputSchema>;
export const ADMIN_CONFIRM_EXCLUSION_ERROR_CODES = [
  'FORBIDDEN',
  /** Aucune exclusion sous cet identifiant. */
  'SANCTION_NOT_FOUND',
  'ALREADY_CONFIRMED',
  /** L'auteur de la proposition, ou le compte exclu, ne la valide pas : un autre compte le fait. */
  'SECOND_PERSON_REQUIRED',
] as const;

/** Commande `admin.hideMessage` : masque un message ; il reste listé, sans son texte pour les joueurs. */
export const adminHideMessageInputSchema = z.strictObject({ messageId: z.uuid() });
export type AdminHideMessageInput = z.infer<typeof adminHideMessageInputSchema>;
export const adminHideMessageOutputSchema = z.object({
  messageId: z.uuid(),
  hiddenAt: z.iso.datetime(),
});
export type AdminHideMessageOutput = z.infer<typeof adminHideMessageOutputSchema>;
export const ADMIN_HIDE_MESSAGE_ERROR_CODES = [
  'FORBIDDEN',
  /** Message inconnu ou purgé. */
  'MESSAGE_NOT_FOUND',
  /** Déjà masqué. */
  'MESSAGE_HIDDEN',
] as const;

/**
 * Commande `admin.resolveReport` : écarte ou retient un signalement ouvert, et avec lui les autres signalements
 * ouverts du même message (une entrée de la file). Ni par le compte signalé, ni par un compte qui a signalé ce message.
 */
export const adminResolveReportInputSchema = z.strictObject({
  reportId: z.uuid(),
  decision: z.enum(['dismissed', 'upheld']),
});
export type AdminResolveReportInput = z.infer<typeof adminResolveReportInputSchema>;
export const adminResolveReportOutputSchema = z.object({
  /** Signalements traités, le désigné compris, dans l'ordre de leur dépôt. */
  reportIds: z.array(z.uuid()).min(1),
  decision: z.enum(['dismissed', 'upheld']),
});
export type AdminResolveReportOutput = z.infer<typeof adminResolveReportOutputSchema>;
export const ADMIN_RESOLVE_REPORT_ERROR_CODES = [
  'FORBIDDEN',
  'REPORT_NOT_FOUND',
  'ALREADY_RESOLVED',
  /** Le compte de la maison signalée, ou d'une maison qui a signalé le message, ne le traite pas. */
  'SECOND_PERSON_REQUIRED',
] as const;

/**
 * Commande `admin.decideAppeal` : tranche l'appel d'une sanction, par un autre compte que son auteur et que le
 * compte sanctionné. Accueilli, il lève la sanction si elle n'est pas finie : elle finit à cet instant.
 */
export const adminDecideAppealInputSchema = z.strictObject({
  sanctionId: z.uuid(),
  decision: z.enum(['granted', 'rejected']),
});
export type AdminDecideAppealInput = z.infer<typeof adminDecideAppealInputSchema>;
export const adminDecideAppealOutputSchema = z.object({
  sanctionId: z.uuid(),
  decision: z.enum(['granted', 'rejected']),
  /** Instant de la levée ; nul si l'appel est rejeté, ou si la sanction était déjà finie. */
  liftedAt: z.iso.datetime().nullable(),
});
export type AdminDecideAppealOutput = z.infer<typeof adminDecideAppealOutputSchema>;
export const ADMIN_DECIDE_APPEAL_ERROR_CODES = [
  'FORBIDDEN',
  'SANCTION_NOT_FOUND',
  /** La sanction n'a pas d'appel. */
  'NOT_APPEALED',
  'APPEAL_DECIDED',
  /** L'auteur de la sanction, ou le compte sanctionné, ne tranche pas l'appel. */
  'SECOND_PERSON_REQUIRED',
] as const;

/** Une sanction est prononcée (une exclusion, proposée). Ni le motif ni l'auteur : le journal les garde. */
export const sanctionPronouncedSchema = z.strictObject({
  type: z.literal('SanctionPronounced'),
  payload: z.strictObject({
    sanctionId: z.uuid(),
    userId: z.uuid(),
    kind: z.enum(['warning', 'silence', 'suspension', 'ban']),
    pending: z.boolean(),
  }),
});
export const exclusionConfirmedSchema = z.strictObject({
  type: z.literal('ExclusionConfirmed'),
  payload: z.strictObject({ sanctionId: z.uuid(), userId: z.uuid() }),
});
export const messageHiddenSchema = z.strictObject({
  type: z.literal('MessageHidden'),
  payload: z.strictObject({ messageId: z.uuid() }),
});
export const reportsResolvedSchema = z.strictObject({
  type: z.literal('ReportsResolved'),
  payload: z.strictObject({
    reportIds: z.array(z.uuid()).min(1),
    decision: z.enum(['dismissed', 'upheld']),
  }),
});
export const appealDecidedSchema = z.strictObject({
  type: z.literal('AppealDecided'),
  payload: z.strictObject({
    sanctionId: z.uuid(),
    decision: z.enum(['granted', 'rejected']),
    lifted: z.boolean(),
  }),
});

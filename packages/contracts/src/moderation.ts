import { z } from 'zod';
import { CONTROL_CHARACTERS } from './chat';

/**
 * Modération, côté joueur (docs/specs/15-back-office-olympe.md, 15.1 ; 18, contenus ; #275) : signaler un
 * message, voir ses sanctions et en faire appel. Les commandes d'administration viennent avec #276.
 */

/**
 * Sanctions graduées (13, 15.1) : un avertissement ne bloque rien ; un silence refuse `chat.post`
 * (`SILENCED`) ; une suspension et une exclusion refusent toute commande de jeu (`SUSPENDED`), sauf l'appel et
 * l'annulation d'un ordre (#528). Une exclusion est définitive (sans fin), et n'est en vigueur qu'une fois validée
 * par une seconde personne (15.4), qui annule alors les ordres ouverts du compte et rend leur séquestre.
 */
export const SANCTION_KINDS = ['warning', 'silence', 'suspension', 'ban'] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];

/** Plafond technique d'un appel, en caractères : celui de la base (`sanctions_appeal_length`). */
export const APPEAL_BODY_MAX_CHARS = 2_000;

/** Texte d'un appel : mêmes règles qu'un message (6.6), plafond technique propre. */
export const appealBodySchema = z
  .string()
  .trim()
  .min(1)
  .refine((text) => [...text].length <= APPEAL_BODY_MAX_CHARS, {
    message: `at most ${APPEAL_BODY_MAX_CHARS} characters`,
  })
  .refine((text) => !CONTROL_CHARACTERS.test(text), { message: 'control characters' });

/**
 * Commande `chat.report` : la maison signale un message d'une autre maison, dans un canal qu'elle lit, sous l'un
 * des motifs de la configuration (`moderation.reportReasons`). Un signalement par maison et par message.
 */
export const chatReportInputSchema = z.strictObject({
  messageId: z.uuid(),
  reason: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
});
export type ChatReportInput = z.infer<typeof chatReportInputSchema>;
export const chatReportOutputSchema = z.object({
  reportId: z.uuid(),
  messageId: z.uuid(),
  reportedAt: z.iso.datetime(),
});
export type ChatReportOutput = z.infer<typeof chatReportOutputSchema>;

/** Commande `moderation.appeal` : le compte fait appel d'une de ses sanctions en vigueur, une fois. */
export const moderationAppealInputSchema = z.strictObject({
  sanctionId: z.uuid(),
  body: appealBodySchema,
});
export type ModerationAppealInput = z.infer<typeof moderationAppealInputSchema>;
export const moderationAppealOutputSchema = z.object({
  sanctionId: z.uuid(),
  appealedAt: z.iso.datetime(),
});
export type ModerationAppealOutput = z.infer<typeof moderationAppealOutputSchema>;

export const CHAT_REPORT_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Aucun message lisible par la maison sous cet identifiant (inconnu, purgé, d'un canal qu'elle ne lit pas). */
  'MESSAGE_NOT_FOUND',
  /** Une maison ne signale pas ses propres messages. */
  'OWN_MESSAGE',
  /** Le message est déjà masqué par la modération. */
  'MESSAGE_HIDDEN',
  /** Motif absent de `moderation.reportReasons`. */
  'REASON_NOT_FOUND',
  /** La maison a déjà signalé ce message. */
  'ALREADY_REPORTED',
] as const;
export const MODERATION_APPEAL_ERROR_CODES = [
  /** Aucune sanction de ce compte sous cet identifiant (ou une exclusion pas encore validée). */
  'SANCTION_NOT_FOUND',
  /** La sanction est finie : on ne fait appel que d'une sanction en vigueur. */
  'SANCTION_ENDED',
  /** Un appel par sanction. */
  'ALREADY_APPEALED',
  /** Plus long que `moderation.maxAppealLength` caractères. */
  'APPEAL_TOO_LONG',
] as const;

/** Un message est signalé. L'événement ne porte pas le texte : il dure plus que la conservation des messages. */
export const messageReportedSchema = z.strictObject({
  type: z.literal('MessageReported'),
  payload: z.strictObject({
    reportId: z.uuid(),
    messageId: z.uuid(),
    houseId: z.uuid(),
    reason: z.string(),
  }),
});
/** Le compte fait appel d'une sanction. L'événement ne porte pas le texte de l'appel, gardé avec la sanction. */
export const sanctionAppealedSchema = z.strictObject({
  type: z.literal('SanctionAppealed'),
  payload: z.strictObject({ sanctionId: z.uuid() }),
});

import type { AiRequest } from '@oikos/ai';
import { TRIAGE_CATEGORIES, type TriageCategory } from '@oikos/contracts';
import { z } from 'zod';
import { numbersInText, writtenNumbers } from '../chronicle/numbers';
import { cityNameIssues } from '../oracle/check';

/**
 * Pré-tri d'un message signalé par la passerelle IA (usage `moderation_triage`, 8.1, 8.4, 15.1, ADR 0005 ; #763). Le
 * modèle reçoit comme données le pseudonyme de la maison qui a écrit le message et son texte, rien d'autre : ni motif,
 * ni signalant, ni contexte, ni compte. Il rend une catégorie d'une liste fermée et un résumé d'une phrase. Le texte
 * signalé est une donnée, jamais une instruction (8.4) : il ne va que dans le bloc de données de la passerelle, et la
 * vraie garantie est le schéma de sortie. La catégorie n'est qu'une indication pour la file : aucune commande de
 * sanction ne la lit.
 * Repli : `null`, le message n'a pas de catégorie et la file garde son ordre de la phase 2.
 */
export const TRIAGE_INSTRUCTIONS = [
  'Tu aides la modération d’un jeu de gestion de la Grèce antique.',
  'Les données contiennent le pseudonyme `author` d’un joueur et le texte `text` d’un message de discussion qu’un autre joueur a signalé.',
  'Range ce message dans une catégorie `category` : `likely_violation` (violation probable : insulte, harcèlement, haine, pourriel, triche),',
  '`doubtful` (douteux : ambigu, ou dépendant du contexte) ou `likely_unfounded` (probablement infondé : rien de répréhensible).',
  'Résume-le en une seule phrase courte, en français, dans `summary`, sans recopier d’insulte.',
  'N’écris aucun nombre ni aucun nom de maison qui ne figure pas dans le message.',
  'Tu ne proposes aucune sanction. Réponds par un objet JSON {"category": "…", "summary": "…"}, sans autre clé.',
].join(' ');

/** Ce que le pré-tri range pour un message : sa catégorie et son résumé. */
export interface Triage {
  category: TriageCategory;
  summary: string;
}

/** Nombres et noms de maison que le résumé cite sans que le message les porte (règle 6) : vide si le résumé est sain. */
export function triageSummaryIssues(
  summary: string,
  body: string,
  houseNames: readonly string[],
): string[] {
  const fold = (value: string | number) => String(value).normalize('NFKC').toLowerCase();
  const knownDigits = new Set(numbersInText(body).map(String));
  const knownWords = new Set(writtenNumbers(body).map(fold));
  const knownNames = new Set(cityNameIssues(body, houseNames));
  return [
    ...numbersInText(summary)
      .map(String)
      .filter((value) => !knownDigits.has(value)),
    ...writtenNumbers(summary).filter((value) => !knownWords.has(fold(value))),
    ...cityNameIssues(summary, houseNames).filter((name) => !knownNames.has(name)),
  ];
}

/**
 * Schéma de la réponse : une catégorie de la liste et un résumé d'une ligne, de 1 à `maxSummaryLength` caractères,
 * sans nombre ni nom de maison absent du message. Toute autre clé, catégorie ou résumé est rejeté.
 */
export function triageSchema(
  body: string,
  houseNames: readonly string[],
  maxSummaryLength: number,
): z.ZodType<Triage | null> {
  return z
    .strictObject({
      category: z.enum(TRIAGE_CATEGORIES),
      summary: z
        .string()
        .trim()
        .min(1)
        .max(maxSummaryLength)
        // Une phrase sur une ligne : ni saut de ligne ni caractère de contrôle.
        .refine((text) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(text), { message: 'one line' }),
    })
    .superRefine((triage, ctx) => {
      if (triageSummaryIssues(triage.summary, body, houseNames).length > 0)
        ctx.addIssue({
          code: 'custom',
          path: ['summary'],
          message: 'number or house not in the message',
        });
    });
}

/** Requête de pré-tri : consignes constantes ; pseudonyme et texte comme données ; sans catégorie sur tout échec. */
export function triageRequest(
  message: { houseName: string; body: string },
  houseNames: readonly string[],
  maxSummaryLength: number,
): AiRequest<Triage | null> {
  return {
    usage: 'moderation_triage',
    instructions: TRIAGE_INSTRUCTIONS,
    data: { author: message.houseName, text: message.body },
    schema: triageSchema(message.body, houseNames, maxSummaryLength),
    fallback: null,
  };
}

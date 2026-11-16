import type { AiRequest } from '@oikos/ai';
import type { ChronicleFacts } from '@oikos/sim';
import { z } from 'zod';
import { CHRONICLE_LOCALES, type ChronicleContext, type ChronicleTexts } from './compose';
import { chronicleNames, numberIssues } from './numbers';

/**
 * Réécriture de la chronique par la passerelle IA (usage `chronicle`, 8.1, 8.4, ADR 0005 ; #271). Le modèle reçoit
 * les faits et la chronique de repli comme données, et rend un texte par langue ; la passerelle garde le repli si
 * la réponse n'est pas conforme : un texte vide ou trop long, un nombre en chiffres absent des faits, ou un nombre
 * écrit autrement qu'en chiffres latins (règle 6 : le modèle ne décide d'aucun chiffre).
 */
export const CHRONICLE_INSTRUCTIONS = [
  "Tu es le chroniqueur d'une cité de la Grèce antique, dans un jeu de gestion.",
  'Réécris la chronique du jour fournie dans les données (brouillon `draft`, en français `fr` et en anglais `en`),',
  'dans le ton vivant d’une gazette antique, en gardant chaque fait et sans en ajouter aucun.',
  'Écris chaque nombre en chiffres, exactement comme dans les faits ; n’en invente, n’en arrondis ni n’en calcule',
  'aucun, et n’écris aucun nombre en lettres ni en chiffres romains (« un », « une », « one » et « a » restent permis).',
  'Garde les noms des maisons, des cités et des biens tels quels.',
  'Réponds par un objet JSON {"fr": "…", "en": "…"} : paragraphes séparés par une ligne vide, sans titre.',
].join(' ');

/**
 * Schéma de la réponse : un texte par langue, de 1 à `maxTextLength` caractères, qui ne cite que des nombres des
 * faits, en chiffres latins (`numberIssues`).
 */
export function chronicleRewriteSchema(
  facts: ChronicleFacts,
  names: readonly string[],
  maxTextLength: number,
): z.ZodType<ChronicleTexts> {
  const text = z.string().trim().min(1).max(maxTextLength);
  return z.strictObject({ fr: text, en: text }).superRefine((texts, ctx) => {
    for (const locale of CHRONICLE_LOCALES) {
      if (numberIssues(texts[locale], facts, names).length > 0)
        ctx.addIssue({ code: 'custom', path: [locale], message: 'number not in the facts' });
    }
  });
}

/**
 * Requête de réécriture : consignes constantes ; les faits et la chronique de repli, où figurent les noms des
 * maisons écrits par des joueurs, passent comme données ; le repli est rendu sur tout échec.
 */
export function chronicleRewriteRequest(
  facts: ChronicleFacts,
  draft: ChronicleTexts,
  context: ChronicleContext,
  maxTextLength: number,
): AiRequest<ChronicleTexts> {
  const names = chronicleNames(facts, context);
  return {
    usage: 'chronicle',
    instructions: CHRONICLE_INSTRUCTIONS,
    data: { facts, draft },
    schema: chronicleRewriteSchema(facts, names, maxTextLength),
    fallback: draft,
  };
}

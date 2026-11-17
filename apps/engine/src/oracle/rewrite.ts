import type { AiRequest } from '@oikos/ai';
import type { WorldEventModel } from '@oikos/config';
import { z } from 'zod';
import { oracleTextIssues } from './check';
import { goodName, ORACLE_LOCALES, type OracleTexts } from './compose';

/**
 * Réécriture d'un oracle par la passerelle IA (usage `oracle`, 7.3, 8.1, 8.4, ADR 0005 ; #270). Le modèle reçoit
 * comme données la nature de l'événement réel, le bien d'une caravane et l'oracle de repli, jamais un texte de
 * joueur, ni la cité, ni le jour, ni l'ampleur ; il rend un texte par langue. La passerelle garde le repli si la
 * réponse n'est pas conforme : un texte vide ou trop long, un nombre sous quelque forme que ce soit, une lettre
 * hors de l'écriture latine ou un nom de cité (`oracleTextIssues`).
 */
export const ORACLE_INSTRUCTIONS = [
  'Tu es la Pythie de Delphes, dans un jeu de gestion de la Grèce antique.',
  'Réécris l’oracle fourni dans les données (brouillon `draft`, en français `fr` et en anglais `en`),',
  'qui annonce l’événement `event` : volontairement ambigu, en une ou deux phrases imagées,',
  'sans trahir sa nature ni en ajouter une autre, et en gardant le bien `good` quand il y en a un.',
  'N’écris aucun nombre, ni en chiffres, ni en lettres, ni en chiffres romains, aucune date ni durée chiffrée,',
  'aucun nom de cité ni de lieu réel, et seulement des lettres latines.',
  'Réponds par un objet JSON {"fr": "…", "en": "…"}, sans titre.',
].join(' ');

/** Ce que l'IA sait de l'événement : sa nature, et le bien d'une caravane, nommé dans chaque langue. */
export interface OracleEvent {
  model: WorldEventModel;
  goodId: string | null;
}

/** Schéma de la réponse : un texte par langue, de 1 à `maxTextLength` caractères, sans nombre ni cité. */
export function oracleRewriteSchema(
  cityNames: readonly string[],
  maxTextLength: number,
): z.ZodType<OracleTexts> {
  const text = z.string().trim().min(1).max(maxTextLength);
  return z.strictObject({ fr: text, en: text }).superRefine((texts, ctx) => {
    for (const locale of ORACLE_LOCALES) {
      if (oracleTextIssues(texts[locale], cityNames).length > 0)
        ctx.addIssue({ code: 'custom', path: [locale], message: 'number or city in the oracle' });
    }
  });
}

/** Requête de réécriture : consignes constantes ; l'événement et le repli comme données ; le repli sur tout échec. */
export function oracleRewriteRequest(
  event: OracleEvent,
  draft: OracleTexts,
  cityNames: readonly string[],
  maxTextLength: number,
): AiRequest<OracleTexts> {
  const good =
    event.goodId === null
      ? null
      : { fr: goodName('fr', event.goodId), en: goodName('en', event.goodId) };
  return {
    usage: 'oracle',
    instructions: ORACLE_INSTRUCTIONS,
    data: { event: { model: event.model, good }, draft },
    schema: oracleRewriteSchema(cityNames, maxTextLength),
    fallback: draft,
  };
}

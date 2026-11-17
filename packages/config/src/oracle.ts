import { z } from 'zod';

/**
 * La Pythie (docs/specs/07-dieux-faveur-evenements.md, 7.3 ; #270). Consulter l'oracle est une offrande de monnaie
 * à son dieu, au prix de la consultation : la maison gagne la Charis de ces oboles au taux du dieu, et lit les
 * oracles des événements à venir de sa cité. Le dieu doit accepter la monnaie.
 * Lue par les joueurs (vue `public.temple_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const oracleSchema = z.strictObject({
  /** Dieu de la Pythie, parmi `gods`, qui accepte la monnaie (`charisPerObole` non nul). */
  godId: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  /** Prix d'une consultation, en oboles, détruites par le puits `sink_offerings`. */
  consultationOboles: z.number().int().min(1).max(1_000_000_000),
  /**
   * Longueur maximale de chaque texte d'oracle réécrit par l'IA (`fr`, `en`), en caractères ; au-delà, le repli
   * est gardé. Plafond technique de 1 000 caractères, que la base vérifie aussi.
   */
  maxTextLength: z.number().int().min(80).max(1_000),
});
export type OracleRules = z.infer<typeof oracleSchema>;

/**
 * Contrôle qui demande le reste de la configuration : le dieu de la Pythie est connu et accepte la monnaie, sinon
 * une consultation ne rapporterait aucune Charis. Rend des chemins sous `oracle`.
 */
export function oracleIssues(
  oracle: OracleRules,
  gods: readonly { id: string; charisPerObole: number }[],
): { path: (string | number)[]; message: string }[] {
  const god = gods.find((candidate) => candidate.id === oracle.godId);
  if (!god) return [{ path: ['godId'], message: `unknown god "${oracle.godId}"` }];
  if (god.charisPerObole <= 0)
    return [{ path: ['godId'], message: `god "${oracle.godId}" does not accept money` }];
  return [];
}

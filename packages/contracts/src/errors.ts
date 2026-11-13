import { z } from 'zod';

/** Erreurs partagées par toutes les commandes. Le client traduit le code, jamais le message. */
export const COMMON_ERROR_CODES = ['UNAUTHENTICATED', 'VALIDATION_FAILED', 'INTERNAL'] as const;

export const commandErrorSchema = z.object({
  code: z.string(),
  /** Détail technique en anglais, pour les journaux ; jamais affiché tel quel. */
  message: z.string(),
  /** Chemins des champs en cause pour VALIDATION_FAILED. */
  fields: z.array(z.string()).optional(),
});
export type CommandError = z.infer<typeof commandErrorSchema>;

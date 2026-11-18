import { z } from 'zod';

/**
 * Intendants (docs/specs/04-systemes-gestion.md, 4.4 ; #278) : chaque site d'une maison peut avoir le sien, qui
 * mène ses règles de gestion. Lue par les joueurs (vue `public.site_rules`, clé `stewards` de la colonne
 * `sites`, sans les noms) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const stewardsSchema = z
  .strictObject({
    /**
     * Postes d'intendant d'une maison par niveau de siège, le premier d'abord. Seul le premier niveau existe
     * pour l'instant (toute maison y est, comme pour `sites.limitByHeadquartersLevel`). 0 : aucun poste.
     */
    limitByHeadquartersLevel: z.array(z.number().int().min(0).max(100)).min(1).max(10),
    /**
     * Salaire d'un intendant par jour de jeu, en oboles, payé à la clôture et détruit (puits
     * `sink_npc_wages`, 5.5). Nul : pas de salaire.
     */
    dailyWageOboles: z.number().int().min(0).max(1_000_000_000),
    /** Règles au plus par intendant ; plafond technique de 20, celui du contrat (`MAX_STEWARD_RULES`). */
    rulesPerSteward: z.number().int().min(1).max(20),
    /**
     * Opérations au plus par intendant et par tick (#279), menées dans l'ordre de ses règles. Absent d'une version
     * publiée avant l'exécution des règles : une, la valeur de départ.
     */
    operationsPerTick: z.number().int().min(1).max(20).default(1),
    /** Noms que reçoit un intendant à son embauche, tirés au hasard : du contenu, pas de l'équilibrage. */
    names: z
      .array(
        z
          .string()
          .min(1)
          .max(40)
          .refine((name) => name.trim() === name, 'no leading or trailing space'),
      )
      .min(1)
      .max(500),
  })
  .superRefine((stewards, ctx) => {
    const seen = new Set<string>();
    stewards.names.forEach((name, index) => {
      if (seen.has(name))
        ctx.addIssue({
          code: 'custom',
          path: ['names', index],
          message: `duplicate name "${name}"`,
        });
      seen.add(name);
    });
  });
export type StewardsRules = z.infer<typeof stewardsSchema>;

/** Une configuration, ou la part qui porte les intendants : absente d'une version publiée avant eux. */
type WithStewards = { stewards?: StewardsRules | undefined };

/** Postes d'intendant d'une maison (premier niveau de siège) : aucun avant les intendants. */
export function stewardLimit(config: WithStewards): number {
  return config.stewards?.limitByHeadquartersLevel[0] ?? 0;
}

/** Salaire d'un intendant pour un jour, en oboles : nul pour une version publiée avant les intendants. */
export function stewardDailyWageOboles(config: WithStewards): number {
  return config.stewards?.dailyWageOboles ?? 0;
}

/** Règles au plus par intendant : aucune avant les intendants. */
export function stewardRulesLimit(config: WithStewards): number {
  return config.stewards?.rulesPerSteward ?? 0;
}

/** Opérations au plus par intendant et par tick : aucune avant les intendants. */
export function stewardOperationsPerTick(config: WithStewards): number {
  return config.stewards?.operationsPerTick ?? 0;
}

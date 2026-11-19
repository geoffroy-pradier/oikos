import { z } from 'zod';

/**
 * Conservation des opérations d'intendant pour une version publiée avant ce paramètre, ou sans intendants : 30 jours.
 * FIGÉE, pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_STEWARD_OPERATIONS_RETENTION_DAYS = 30;

/**
 * Repos d'une règle refusée pour une version publiée avant ce paramètre : 5 ticks. FIGÉE, pour la même raison que
 * `DEFAULT_SITES`.
 */
export const DEFAULT_STEWARD_REFUSAL_REST_TICKS = 5;

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
    /**
     * Conservation des opérations d'intendant (#561), en jours : au-delà, le moteur les supprime, sauf la dernière de
     * chaque intendant et celles du dernier tick de son monde. Au moins un jour, comme la purge de la base. Absent
     * d'une version publiée avant elle : `DEFAULT_STEWARD_OPERATIONS_RETENTION_DAYS`.
     */
    operationsRetentionDays: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .default(DEFAULT_STEWARD_OPERATIONS_RETENTION_DAYS),
    /**
     * Repos d'une règle refusée (#621), en ticks : refusée à un tick, elle est passée comme une règle qui n'a rien à
     * faire jusqu'à ce tick plus ce repos, puis retentée. 0 : retentée à chaque opération. Absent d'une version
     * publiée avant lui : `DEFAULT_STEWARD_REFUSAL_REST_TICKS`.
     */
    refusalRestTicks: z.number().int().min(0).max(1000).default(DEFAULT_STEWARD_REFUSAL_REST_TICKS),
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

/** Conservation des opérations d'intendant, en jours : celle d'avant le paramètre pour une version sans intendants. */
export function stewardOperationsRetentionDays(config: WithStewards): number {
  return config.stewards?.operationsRetentionDays ?? DEFAULT_STEWARD_OPERATIONS_RETENTION_DAYS;
}

/** Repos d'une règle refusée, en ticks : aucun avant les intendants. */
export function stewardRefusalRestTicks(config: WithStewards): number {
  return config.stewards?.refusalRestTicks ?? 0;
}

import { z } from 'zod';

/** Ligne de la vue publique `city_population` (docs/specs/05-economie.md, 5.2). */
const rowSchema = z.object({
  class_id: z.string().min(1),
  population: z.number().int().nonnegative(),
  // Couverture des besoins vitaux retenue à la dernière clôture ; nulle tant qu'aucune clôture ne l'a mesurée.
  coverage_bps: z.number().int().min(0).max(10_000).nullable(),
});
export type ClassPopulation = z.infer<typeof rowSchema>;

export interface CityPopulation {
  classes: ClassPopulation[];
  /** Total des habitants de la cité. */
  total: number;
}

/**
 * Lit la population d'une cité. `null` si une ligne est illisible : l'écran annonce un échec plutôt
 * qu'un chiffre faux. Les classes vont de la plus peuplée à la moins peuplée (à égalité, par identifiant).
 */
export function parseCityPopulation(raw: unknown): CityPopulation | null {
  const parsed = z.array(rowSchema).safeParse(raw);
  if (!parsed.success) return null;
  const classes = [...parsed.data].sort(
    (a, b) => b.population - a.population || a.class_id.localeCompare(b.class_id),
  );
  const total = classes.reduce((sum, row) => sum + row.population, 0);
  return Number.isSafeInteger(total) ? { classes, total } : null;
}

/**
 * Couverture en fraction (0 à 1) pour `Intl.NumberFormat` en pourcentage, arrondie au point de
 * pourcentage inférieur comme la règle (5.2) : une classe sous le seuil n'est jamais affichée au seuil.
 * `null` si non mesurée.
 */
export const coverageShare = (row: ClassPopulation) =>
  row.coverage_bps === null ? null : Math.floor(row.coverage_bps / 100) / 100;

import { charisDecay } from '@oikos/sim';
import { z } from 'zod';

const id = z.string().min(1);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * Ce que le client lit des règles des temples (vue `public.temple_rules`, 7.1 et 7.3) : les dieux de la
 * configuration en vigueur. Schéma souple sur la forme, comme `site-rules.ts` : un champ nouveau
 * reste lisible. Un dieu d'une version publiée avant la Charis ne porte que son identifiant : les valeurs par
 * défaut sont celles du schéma de la configuration (aucune offrande acceptée, aucun déclin), comme pour l'API.
 * L'API fait foi ; le client ne s'en sert que pour proposer et annoncer.
 */
const godSchema = z.object({
  id,
  charisPerObole: count.default(0),
  charisPerUnit: z.record(id, count).default({}),
  dailyDecayBps: z.number().int().min(0).max(10_000).default(0),
});
// Une colonne nulle : la section manque à la version en vigueur.
const rulesSchema = z.object({ gods: z.array(godSchema).nullish() });
export type TempleGod = z.infer<typeof godSchema>;
export interface TempleRules {
  gods: TempleGod[];
}

/**
 * Règles des temples lues dans la ligne de `temple_rules`. Aucune ligne (aucune configuration en vigueur) : aucun
 * dieu. `null` si la ligne est illisible : l'écran annonce un échec.
 */
export function parseTempleRules(row: unknown): TempleRules | null {
  const parsed = rulesSchema.safeParse(row ?? {});
  return parsed.success ? { gods: parsed.data.gods ?? [] } : null;
}

/**
 * Charis de la maison par dieu (vue `my_favor`) ; un dieu sans ligne a une Charis nulle. `null` si une ligne est
 * illisible : jamais prise pour une Charis nulle.
 */
export function parseFavor(rows: unknown, houseId: string): Map<string, number> | null {
  const parsed = z.array(z.object({ house_id: id, god_id: id, charis: count })).safeParse(rows);
  if (!parsed.success) return null;
  return new Map(
    parsed.data.filter((row) => row.house_id === houseId).map((row) => [row.god_id, row.charis]),
  );
}

/**
 * Charis d'une cité envers son dieu protecteur (vue `city_charis`) ; `undefined` si la cité n'en a pas, `null`
 * si une ligne est illisible.
 */
export function parseCityCharis(rows: unknown, cityId: string) {
  const parsed = z.array(z.object({ city_id: id, god_id: id, charis: count })).safeParse(rows);
  if (!parsed.success) return null;
  const row = parsed.data.find((line) => line.city_id === cityId);
  return row && { godId: row.god_id, charis: row.charis };
}

/** Charis de la maison envers chaque dieu de la configuration, et ce qu'elle perdra à la prochaine clôture. */
export function charisByGod(rules: TempleRules, favor: ReadonlyMap<string, number>) {
  return rules.gods.map((god) => {
    const charis = favor.get(god.id) ?? 0;
    return { god, charis, decay: charisDecay(charis, god.dailyDecayBps) };
  });
}

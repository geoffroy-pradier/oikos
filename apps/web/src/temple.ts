import { charisDecay, offeringCharis, type OfferingGifts } from '@oikos/sim';
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

/** Le dieu accepte au moins un don : la monnaie, ou un bien. */
export const acceptsOfferings = (god: TempleGod) =>
  god.charisPerObole > 0 || Object.values(god.charisPerUnit).some((rate) => rate > 0);

/**
 * Charis qu'une offrande rapportera, annoncée avant l'envoi, par le calcul de l'API (`offeringCharis`) ; `null`
 * si le dieu refuse un des dons, si l'offrande est vide ou si le gain dépasse les entiers sûrs.
 */
export function offeringQuote(god: TempleGod, gifts: OfferingGifts): number | null {
  if (gifts.oboles === 0 && gifts.goods.length === 0) return null;
  try {
    const quote = offeringCharis(god, gifts);
    return quote.ok && quote.charis > 0 ? quote.charis : null;
  } catch {
    return null;
  }
}

/**
 * Intention d'une commande qui fait monter la Charis de la maison envers `godId` (offrande, consultation de la
 * Pythie), comptée sur cette Charis telle que relue à la demande : restée sans réponse, la même demande repart sous
 * la même clé ; une relecture qui montre une autre Charis (la demande a abouti, ou un déclin, une grâce l'a changée)
 * rend sa clé, et la même saisie devient une demande neuve (`charisIntentStale`).
 */
export const charisIntent = (kind: string, godId: string, charis: number, detail = '') =>
  `${kind}:${godId}:${charis}:${detail}`;

/** Intentions de ce genre faites sous une autre Charis que celle relue maintenant : leur clé est caduque. */
export const charisIntentStale =
  (kind: string, favor: ReadonlyMap<string, number>) => (intent: string) => {
    const match = new RegExp(`^${kind}:([^:]+):(\\d+):`).exec(intent);
    return !!match?.[1] && Number(match[2]) !== (favor.get(match[1]) ?? 0);
  };

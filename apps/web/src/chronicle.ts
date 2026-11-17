import { z } from 'zod';

/** Une chronique de la cité (vue `chronicle_articles`, #271) : son jour de jeu, ses textes, sa source. */
export interface ChronicleArticle {
  id: string;
  gameDay: number;
  texts: { fr: string; en: string };
  /** `ai` : réécrite par l'IA à partir des faits ; `fallback` : composée par les gabarits. */
  source: 'ai' | 'fallback';
}

const rowSchema = z.object({
  id: z.string().min(1),
  city_id: z.string().min(1),
  game_day: z.number().int(),
  text_fr: z.string().min(1),
  text_en: z.string().min(1),
  source: z.enum(['ai', 'fallback']),
});

/**
 * Chroniques d'une cité, de la plus récente à la plus ancienne ; `null` si une ligne est illisible (l'écran
 * annonce un échec plutôt qu'une chronique fausse).
 */
export function parseChronicle(rows: unknown, cityId: string): ChronicleArticle[] | null {
  const parsed = z.array(rowSchema).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .filter((row) => row.city_id === cityId)
    .sort((a, b) => b.game_day - a.game_day)
    .map((row) => ({
      id: row.id,
      gameDay: row.game_day,
      texts: { fr: row.text_fr, en: row.text_en },
      source: row.source,
    }));
}

/** Texte de la langue de l'écran (le français sinon), en paragraphes séparés par une ligne vide. */
export function chronicleParagraphs(article: ChronicleArticle, language: string): string[] {
  const text = language.startsWith('en') ? article.texts.en : article.texts.fr;
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

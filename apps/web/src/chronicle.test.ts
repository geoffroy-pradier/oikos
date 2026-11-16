import { describe, expect, it } from 'vitest';
import { chronicleParagraphs, parseChronicle } from './chronicle';

const row = (id: string, gameDay: number, extra: object = {}) => ({
  id,
  city_id: 'c1',
  game_day: gameDay,
  text_fr: 'Un.\n\n  Deux.  \n \n\nTrois.',
  text_en: 'One.\n\nTwo.',
  source: 'fallback',
  ...extra,
});

describe('chronique de la cité (#271)', () => {
  it('les chroniques de la cité, de la plus récente à la plus ancienne ; une ligne illisible : `null`', () => {
    const rows = [row('a', 3), row('b', 5, { source: 'ai' }), row('c', 4, { city_id: 'c2' })];
    expect(parseChronicle(rows, 'c1')?.map((article) => [article.id, article.source])).toEqual([
      ['b', 'ai'],
      ['a', 'fallback'],
    ]);
    expect(parseChronicle([], 'c1')).toEqual([]);
    for (const wrong of [{ source: 'oracle' }, { text_fr: '' }, { game_day: 1.5 }, { id: null }])
      expect(parseChronicle([row('a', 3, wrong)], 'c1')).toBeNull();
    expect(parseChronicle(null, 'c1')).toBeNull();
  });

  it('les paragraphes de la langue de l’écran, le français à défaut ; lignes vides ignorées', () => {
    const [article] = parseChronicle([row('a', 3)], 'c1') ?? [];
    if (!article) throw new Error('article expected');
    expect(chronicleParagraphs(article, 'fr')).toEqual(['Un.', 'Deux.', 'Trois.']);
    expect(chronicleParagraphs(article, 'en-GB')).toEqual(['One.', 'Two.']);
    expect(chronicleParagraphs(article, 'de')).toEqual(['Un.', 'Deux.', 'Trois.']);
  });
});

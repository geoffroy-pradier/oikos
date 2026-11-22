import { NEMESIS_MODELS } from '@oikos/config';
import { describe, expect, it } from 'vitest';
import { CHRONICLE_LOCALES } from '../chronicle/compose';
import { fallbackOmen, fallbackOmens, omenSeed } from './compose';

describe('présages de repli (7.2, #735)', () => {
  it('chaque modèle a plusieurs présages, autant en français qu’en anglais, sans chiffre ni gabarit', () => {
    for (const model of NEMESIS_MODELS) {
      const [fr, en] = CHRONICLE_LOCALES.map((locale) => fallbackOmens(locale, model));
      expect(fr?.length).toBeGreaterThanOrEqual(3);
      expect(en?.length).toBe(fr?.length);
      for (const text of [...(fr ?? []), ...(en ?? [])]) {
        expect(text.trim()).toBe(text);
        expect(text.length).toBeLessThanOrEqual(1_000);
        expect(text).not.toMatch(/[\p{N}{}]/u);
      }
    }
  });

  it('tiré par la graine : le même texte pour la même graine, au même rang dans les deux langues, tous tirés', () => {
    const seed = omenSeed('graine', '01900000-0000-7000-8000-0000000735a1', 20_780);
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(omenSeed('graine', '01900000-0000-7000-8000-0000000735a1', 20_781)).not.toBe(seed);
    for (const model of NEMESIS_MODELS) {
      const texts = fallbackOmen(model, seed);
      expect(fallbackOmen(model, seed)).toEqual(texts);
      const rank = fallbackOmens('fr', model).indexOf(texts.fr);
      expect(fallbackOmens('en', model)[rank]).toBe(texts.en);
      const drawn = new Set(
        Array.from({ length: 200 }, (_, n) => fallbackOmen(model, omenSeed('g', `h${n}`, 1)).fr),
      );
      expect(drawn.size).toBe(fallbackOmens('fr', model).length);
    }
    expect(() => omenSeed('g', 'h', 0.5)).toThrow(RangeError);
  });
});

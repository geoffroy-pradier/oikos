import { WORLD_EVENT_MODELS } from '@oikos/config';
import { describe, expect, it } from 'vitest';
import { fallbackOracle, fallbackOracles, oracleVariant, ORACLE_LOCALES } from './compose';

const seed = (n: number) => n.toString(16).padStart(64, '0');

describe('oracles de repli (7.3, #270)', () => {
  it('chaque modèle a plusieurs oracles, autant en français qu’en anglais, sans gabarit inconnu', () => {
    for (const model of WORLD_EVENT_MODELS) {
      const [fr, en] = ORACLE_LOCALES.map((locale) => fallbackOracles(locale, model));
      expect(fr?.length).toBeGreaterThanOrEqual(3);
      expect(en?.length).toBe(fr?.length);
      for (const text of [...(fr ?? []), ...(en ?? [])]) {
        expect(text.trim()).toBe(text);
        // Seul le bien d'une caravane est une variable.
        const variables = [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
        expect(variables).toEqual(model === 'caravan' ? ['good'] : []);
      }
    }
  });

  it('choisi par la graine de l’événement : le même oracle pour la même graine, au même rang dans les deux langues', () => {
    const subject = { model: 'drought' as const, goodId: null, seed: seed(42) };
    const texts = fallbackOracle(subject);
    expect(fallbackOracle({ ...subject })).toEqual(texts);
    const variant = oracleVariant(subject);
    expect(texts).toEqual({
      fr: fallbackOracles('fr', 'drought')[variant],
      en: fallbackOracles('en', 'drought')[variant],
    });
  });

  it('tous les oracles d’un modèle sont tirés, et deux modèles d’un même jour tirent chacun le leur', () => {
    for (const model of WORLD_EVENT_MODELS) {
      const drawn = new Set<number>();
      for (let n = 0; n < 200; n++)
        drawn.add(oracleVariant({ model, goodId: 'wine', seed: seed(n) }));
      expect([...drawn].sort()).toEqual(fallbackOracles('fr', model).map((_, index) => index));
    }
    const pairs = new Set<string>();
    for (let n = 0; n < 50; n++) {
      const day = seed(n);
      pairs.add(
        `${oracleVariant({ model: 'drought', goodId: null, seed: day })}:` +
          `${oracleVariant({ model: 'good_year', goodId: null, seed: day })}`,
      );
    }
    expect(pairs.size).toBeGreaterThan(1);
  });

  it('une caravane nomme son bien dans chaque langue ; un bien sans traduction, par son identifiant', () => {
    const texts = fallbackOracle({ model: 'caravan', goodId: 'olive_oil', seed: seed(7) });
    expect(texts.fr).toContain("Huile d'olive");
    expect(texts.en).toContain('Olive oil');
    expect(fallbackOracle({ model: 'caravan', goodId: 'nectar', seed: seed(7) }).fr).toContain(
      'nectar',
    );
    expect(fallbackOracle({ model: 'caravan', goodId: 'constructor', seed: seed(7) }).en).toContain(
      'constructor',
    );
  });
});

import { INITIAL_CONFIG, validateConfig, WORLD_EVENT_MODELS } from '@oikos/config';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cityNameIssues, oracleCityNames, oracleTextIssues } from './check';
import { fallbackOracles, goodName, ORACLE_LOCALES } from './compose';

const names = oracleCityNames([
  { slug: 'kalliste', name: 'Kallistè' },
  { slug: 'nesos', name: 'Nèsos' },
  { slug: 'os', name: 'Os' },
]);
const issues = (text: string) => oracleTextIssues(text, names);
const loaded = validateConfig(INITIAL_CONFIG);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const config = loaded.config;

describe('contrôle d’un oracle réécrit (7.3, #270)', () => {
  it('admet un oracle sans nombre ni cité, articles « un », « une », « one » et « a » compris', () => {
    for (const text of [
      'Une ombre passera sur les champs, et un épi pleurera.',
      'A shadow will pass over the fields, and one ear of grain will weep.',
      'Des marchands chercheront : Huile d’olive.',
    ])
      expect(issues(text), text).toEqual([]);
  });

  it('un nom de moins de quatre lettres n’est cherché qu’en mot entier', () => {
    expect(cityNameIssues('Les cosses et les roses.', names)).toEqual([]);
    expect(cityNameIssues('Un os, puis OS.', names)).toEqual(['os', 'Os']);
  });

  it('chaque oracle de repli passe le contrôle, quel que soit le bien d’une caravane', () => {
    for (const model of WORLD_EVENT_MODELS)
      for (const locale of ORACLE_LOCALES)
        for (const template of fallbackOracles(locale, model))
          for (const good of config.goods) {
            const text = template.replace('{{good}}', goodName(locale, good.id));
            expect(issues(text), text).toEqual([]);
          }
  });

  it('refuse tout chiffre, toute écriture d’un nombre, tout ordinal', () => {
    for (const text of [
      'Dans 3 jours',
      'Au jour ٣',
      'Ⅻ lunes',
      '½ récolte',
      'x² moissons',
      'Dans trois jours, la terre aura soif.',
      'Within three days the earth will thirst.',
      'Une douzaine de navires, la moitié du blé, le double du prix.',
      'Twice the wheat, half the ships, a dozen sails.',
      'Le XIIe jour',
      'Au premier soleil, la mer grondera.',
      'At the first dawn, the sea will roar.',
      'Le troisième jour.',
      'Le second navire.',
      'Une dizaine de lunes.',
      'dеux lunes',
    ])
      expect(issues(text), text).not.toEqual([]);
  });

  it('refuse toute lettre hors de l’écriture latine', () => {
    for (const text of ['Ἀπόλλων parlera.', 'Каллисте', 'Kallistе', 'La mer ο grondera.'])
      expect(issues(text), text).not.toEqual([]);
  });

  it('refuse une cité en clair : casse, accents, ligatures, pleine chasse, invisibles, ponctuée, dérivée, confondue', () => {
    for (const text of [
      'La terre de Kallistè aura soif.',
      'La terre de KALLISTE aura soif.',
      'La terre de kalliste aura soif.',
      'Les Kallistéens auront soif.',
      'The Kallisteans will thirst.',
      'K.a.l.l.i.s.t.è aura soif.',
      'K a l l i s t e aura soif.',
      'Kal-listè aura soif.',
      'Kal​listè aura soif.',
      'Ｋａｌｌｉｓｔｅ aura soif.',
      'KaIIiste aura soif.',
      'Les vignes d’Ampelos.',
      'Elaïa pleurera.',
      'Halos pleurera.',
      'Nèsos pleurera.',
      'NESOS pleurera.',
      'Os pleurera.',
    ])
      expect(issues(text), text).not.toEqual([]);
  });

  it('propriété : un nom de cité glissé dans un texte, sous une casse et des séparateurs quelconques, est relevé', () => {
    const separators = fc.constantFrom('', ' ', '.', '-', '­', '​', '·', "'");
    fc.assert(
      fc.property(
        fc.constantFrom('Kallistè', 'Elaia', 'Ampelos', 'Halos', 'Nèsos'),
        fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
        fc.array(separators, { minLength: 8, maxLength: 8 }),
        fc.string({ maxLength: 40 }),
        fc.string({ maxLength: 40 }),
        (name, upper, between, before, after) => {
          const disguised = [...name]
            .map((char, index) => (upper[index] ? char.toUpperCase() : char.toLowerCase()))
            .map((char, index) => char + (index < name.length - 1 ? (between[index] ?? '') : ''))
            .join('');
          expect(cityNameIssues(`${before} ${disguised} ${after}`, names)).toContain(
            names.find((candidate) => candidate === name) ?? name,
          );
          expect(oracleTextIssues(`${before}${disguised}${after}`, names)).not.toEqual([]);
        },
      ),
    );
  });

  it('propriété : un texte qui contient un caractère numérique est refusé', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }),
        fc.constantFrom('0', '7', '٣', '৪', 'Ⅻ', '½', '²', '７', '𝟕'),
        fc.string({ maxLength: 40 }),
        (before, digit, after) => {
          expect(issues(`${before}${digit}${after}`)).not.toEqual([]);
        },
      ),
    );
  });

  it('les noms cherchés : traductions de toutes les cités connues, identifiants et noms en base du monde', () => {
    const list = oracleCityNames([{ slug: 'nesos', name: 'Nèsos' }]);
    expect(list).toEqual(
      expect.arrayContaining(['Kallistè', 'Elaia', 'Ampelos', 'Halos', 'nesos', 'Nèsos']),
    );
    expect(new Set(list).size).toBe(list.length);
  });
});

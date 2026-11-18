import { INITIAL_CONFIG, validateConfig, WORLD_EVENT_MODELS } from '@oikos/config';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cityNameIssues, letters, oracleCityNames, oracleTextIssues, romanNumerals } from './check';
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

  it('confond avec i et l les lettres latines d’allure trompeuse, et rejette petites capitales et alphabet phonétique (#495)', () => {
    for (const text of [
      'Kaʟʟıstè aura soif.',
      'KAꞀꞀıSTE aura soif.',
      'Kaꞁꞁɩstè aura soif.',
      'KaƖƖiste aura soif.',
      'Kaǀǀɪstè aura soif.',
      'Kaƚƚiste aura soif.',
      'KAƗƗISTE aura soif.',
      'Kaȴȴistè aura soif.',
      'Kaǁistè aura soif.',
      'KaⱠⱠiste aura soif.',
      'Eʟaıa pleurera.',
      'Haꞁos pleurera.',
      'Ampeʟos pleurera.',
    ])
      expect(cityNameIssues(text, names).length, text).toBeGreaterThan(0);
    // « ı » est une lettre turque ordinaire : admise, mais un nom qui l'emploie est relevé.
    expect(issues('Kallıstè aura soif.')).toEqual(['Kallistè', 'kalliste']);
    expect(issues('Bır rüzgâr esecek.')).toEqual([]);
    for (const text of ['ʟa mer grondera.', 'La mer ɢrondera.', 'ᴋᴀʟᴏs', 'Lɑ mer', 'ǀ', 'ỻ', 'ⱡ'])
      expect(issues(text), text).not.toEqual([]);
    // Lettres d'allure de chiffre, et autres lettres des latins étendus, même décomposables (« Ǯ » : « Ʒ » et caron).
    for (const char of [...'ƧƨƻƼƽƄƅƷǮǯȜȝȢȣƗȴŋðþđħŧĸ'])
      expect(issues(`La mer ${char} grondera.`), char).not.toEqual([]);
    expect(issues('Ça, l’œuvre d’Ünal : ș et ț, ỳ et ŵ, ğ et ł ; la mer grondera.')).toEqual([]);
  });

  it('relève un chiffre romain en minuscules ou en casse mêlée qui forme un mot, pas un mot courant (#495)', () => {
    for (const text of [
      'Au xii soleil',
      'Au Xii soleil',
      'au xıı soleil',
      'Dans iii lunes',
      'Le mmxxvi',
    ])
      expect(issues(text), text).not.toEqual([]);
    for (const text of [
      'Celle-ci viendra à mi-chemin ; il mêlera la vie, dire et lire.',
      'A mild, vivid, civil mix; ill winds did dim the lid.',
      'Ci-gît la mer.',
    ])
      expect(issues(text), text).toEqual([]);
  });

  it('propriété : un nom de cité dont les i et l sont remplacés par des lettres d’allure trompeuse est relevé', () => {
    const lookalikes = [...'ilILıɩƖɪɨƗʟꞁꞀƚȽǀłŁȴɫⱢɭⱡⱠ'];
    fc.assert(
      fc.property(
        // Les noms qui ont un i ou un l.
        fc.constantFrom('Kallistè', 'Elaia', 'Ampelos', 'Halos'),
        fc.array(fc.constantFrom(...lookalikes), { minLength: 8, maxLength: 8 }),
        fc.string({ maxLength: 40 }),
        fc.string({ maxLength: 40 }),
        (name, swaps, before, after) => {
          const disguised = [...name]
            .map((char, index) => (/[il]/i.test(char) ? (swaps[index] ?? char) : char))
            .join('');
          expect(cityNameIssues(`${before} ${disguised} ${after}`, names)).toContain(name);
          expect(oracleTextIssues(`${before}${disguised}${after}`, names)).not.toEqual([]);
        },
      ),
    );
  });

  it('propriété : toute lettre des petites capitales, de l’alphabet phonétique ou des latins étendus C à G est refusée', () => {
    // Blocs Unicode : extensions IPA, extensions phonétiques et leur supplément, latin étendu C, D, E, F et G.
    const blocks = [
      [0x0250, 0x02af],
      [0x1d00, 0x1dbf],
      [0x2c60, 0x2c7f],
      [0xa720, 0xa7ff],
      [0xab30, 0xab6f],
      [0x10780, 0x107bf],
      [0x1df00, 0x1dfff],
    ] as const;
    // Les lettres que le repliement NFKC laisse telles quelles ; les autres (« ᴷ ») y deviennent des lettres
    // courantes, que le contrôle lit comme telles.
    const unusual = blocks
      .flatMap(([from, to]) =>
        Array.from({ length: to - from + 1 }, (_, index) => String.fromCodePoint(from + index)),
      )
      .filter((char) => /^\p{Script=Latin}$/u.test(char) && /^\p{L}$/u.test(char))
      .filter((char) => char.normalize('NFKC') === char);
    expect(unusual.length).toBeGreaterThan(300);
    expect(unusual).toEqual(expect.arrayContaining(['ʟ', 'ɩ', 'ꞁ', 'ᴀ', 'ɢ']));
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }),
        fc.constantFrom(...unusual),
        fc.string({ maxLength: 40 }),
        (before, char, after) => {
          expect(issues(`${before}${char}${after}`)).toContain(char);
        },
      ),
    );
  });

  it('propriété : un chiffre romain valide d’au moins deux lettres, en casse quelconque, est relevé ; une autre suite de ses lettres ne l’est pas', () => {
    const toRoman = (value: number) =>
      (
        [
          [1000, 'm'],
          [900, 'cm'],
          [500, 'd'],
          [400, 'cd'],
          [100, 'c'],
          [90, 'xc'],
          [50, 'l'],
          [40, 'xl'],
          [10, 'x'],
          [9, 'ix'],
          [5, 'v'],
          [4, 'iv'],
          [1, 'i'],
        ] as const
      ).reduce(
        ({ rest, text }, [unit, numeral]) => ({
          rest: rest % unit,
          text: text + numeral.repeat(Math.floor(rest / unit)),
        }),
        { rest: value, text: '' },
      ).text;
    const words = new Set(['ci', 'mi', 'mix']);
    const numerals = new Set(Array.from({ length: 3999 }, (_, index) => toRoman(index + 1)));
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3999 }).map(toRoman),
        fc.array(fc.boolean(), { minLength: 15, maxLength: 15 }),
        fc.string({ maxLength: 40 }),
        fc.string({ maxLength: 40 }),
        (numeral, upper, before, after) => {
          fc.pre(numeral.length >= 2 && !words.has(numeral));
          const cased = [...numeral]
            .map((char, index) => (upper[index] ? char.toUpperCase() : char))
            .join('');
          expect(romanNumerals(`${before} ${cased} ${after}`)).toContain(numeral);
          expect(issues(`${before} ${cased} ${after}`)).not.toEqual([]);
        },
      ),
    );
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(...'ivxlcdm'), minLength: 2, maxLength: 8 }),
        (word) => {
          fc.pre(!numerals.has(word));
          expect(romanNumerals(`Le ${word} viendra.`)).toEqual([]);
        },
      ),
    );
  });

  it('propriété réciproque : toute lettre latine admise se replie en lettres de a à z, sur tout Unicode', () => {
    const admitted: string[] = [];
    for (let code = 0; code <= 0x10ffff; code += 1) {
      const char = String.fromCodePoint(code);
      if (!/^\p{L}$/u.test(char) || !/^\p{Script=Latin}$/u.test(char)) continue;
      if (issues(char).length > 0) continue;
      admitted.push(char);
      expect(letters(char), `U+${code.toString(16)} ${char}`).toMatch(/^[a-z]+$/);
    }
    // Lettres de base, accentuées décomposables, ligatures et lettres en exposant repliées, « ı » et « ł ».
    expect(admitted).toEqual(expect.arrayContaining([...'aZéÇșțơŵỳœÆøßẞıłŁǅﬀᴷ']));
    expect(admitted.length).toBeGreaterThan(600);
  });

  it('les noms cherchés : traductions de toutes les cités connues, identifiants et noms en base du monde', () => {
    const list = oracleCityNames([{ slug: 'nesos', name: 'Nèsos' }]);
    expect(list).toEqual(
      expect.arrayContaining(['Kallistè', 'Elaia', 'Ampelos', 'Halos', 'nesos', 'Nèsos']),
    );
    expect(new Set(list).size).toBe(list.length);
  });
});

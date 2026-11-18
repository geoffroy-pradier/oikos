import cityEn from '../chronicle/locales/en.json' with { type: 'json' };
import cityFr from '../chronicle/locales/fr.json' with { type: 'json' };
import { writtenNumbers } from '../chronicle/numbers';

/**
 * Contrôle d'un oracle réécrit (règle 6, 7.3 ; #270, #495) : il ne cite aucun nombre, sous aucune forme, ni aucune
 * cité. Plus strict que celui de la chronique, qui admet les nombres de ses faits : un oracle n'en a aucun.
 * Ce qui fait rejeter un texte :
 * - tout caractère numérique Unicode (`\p{N}`) : chiffres latins ou non, chiffres romains Unicode, fractions,
 *   exposants ;
 * - tout nombre écrit autrement, relevé par le contrôle de la chronique (`writtenNumbers`) : nombres, ordinaux et
 *   quantités en lettres, en français et en anglais (à partir de deux), chiffres romains en capitales, mots qui
 *   mêlent plusieurs écritures ; plus « premier » et « first » ;
 * - tout chiffre romain en minuscules ou en casse mêlée qui forme un mot (`romanNumerals`) ;
 * - toute lettre d'une autre écriture que l'écriture latine, ce qui écarte les lettres d'apparence latine (`е`
 *   cyrillique, `ο` grec) d'un nom de cité déguisé ;
 * - toute lettre latine hors de l'alphabet latin courant (`UNUSUAL_LATIN`) : petites capitales, alphabet
 *   phonétique ;
 * - tout nom de cité (`cityNameIssues`).
 */

/** Caractères de format (espace sans largeur, trait d'union conditionnel…), invisibles. */
const FORMAT = /\p{Cf}/gu;
const DIGIT = /\p{N}/gu;
const NON_LATIN = /(?!\p{Script=Latin})\p{L}/gu;
/**
 * Lettre latine hors de l'alphabet latin courant : une lettre qui, décomposée (NFD, sur le texte replié NFKC), n'est
 * ni une lettre de base (`a` à `z`, en capitale ou non), ni `æ`, `œ`, `ø`, `ß`, `ẞ`, `ı` ou `ł`, que le repliement des
 * noms ramène à des lettres de base. Les lettres accentuées (« é », « ș », « ơ ») sont admises ; sont rejetées les
 * petites capitales (« ʟ », « ᴋ »), les lettres de l'alphabet phonétique (« ɩ », « ɢ »), les lettres d'allure de
 * chiffre (« Ƨ », « ƻ », « Ƽ », « Ʒ », « Ǯ », « Ȝ », « Ȣ »), les clics (« ǀ »), et toutes les autres lettres des latins
 * étendus (« Ɨ », « ȴ », « ŋ », « ð », « ꞁ », « ỻ ») : aucune ne sert à un oracle en français ou en anglais, et plusieurs
 * imitent une lettre courante ou un chiffre. Le repliement NFKC ramène d'abord les lettres en exposant (« ᴷ ») à leur
 * forme simple.
 */
const UNUSUAL_LATIN =
  /(?![A-Za-z\u00C6\u00E6\u0152\u0153\u00D8\u00F8\u00DF\u1E9E\u0131\u0141\u0142])(?=\p{L})\p{Script=Latin}/gu;
const FIRST = /(?<![\p{L}\p{N}])(?:premi[eè]re?s?|first)(?![\p{L}\p{N}])/giu;
/** Au-dessous de cette longueur, un nom n'est cherché que comme mot entier, pas dans le texte serré. */
const SHORT_NAME = 4;

/**
 * Lettres latines d'allure trompeuse, en minuscules, ramenées à la lettre qu'elles imitent : `ı` sans point, `ɩ`
 * iota latin, `ɪ` petite capitale et `ɨ` i barré en `i` ; `ł` et `ƚ` l barrés, `ʟ` petite capitale, `ꞁ` l culbuté,
 * `ȴ` l bouclé, `ɫ`, `ɬ`, `ɭ` et `ⱡ` l phonétiques et `ǀ` clic dental en `l` ; `ǁ` en `ll`. Leurs capitales (`Ɩ`,
 * `Ɨ`, `Ł`, `Ƚ`, `Ꞁ`, `Ɫ`, `Ⱡ`) sont d'abord mises en minuscules. Hors `ı` et `ł`, toutes sont aussi rejetées
 * (`UNUSUAL_LATIN`) : les ramener sert au seul repérage des noms (`cityNameIssues`).
 */
const LOOKALIKES: Readonly<Record<string, string>> = {
  ı: 'i',
  ɩ: 'i',
  ɪ: 'i',
  ɨ: 'i',
  ł: 'l',
  ƚ: 'l',
  ʟ: 'l',
  ꞁ: 'l',
  ȴ: 'l',
  ɫ: 'l',
  ɬ: 'l',
  ɭ: 'l',
  ⱡ: 'l',
  ǀ: 'l',
  ǁ: 'll',
};
const LOOKALIKE = new RegExp(`[${Object.keys(LOOKALIKES).join('')}]`, 'gu');

/**
 * Lettres d'un texte, pour y chercher un nom : repliement NFKC (pleine chasse, ligatures, exposants), sans
 * caractère de format, sans diacritique, en minuscules (`æ` en `ae`, `œ` en `oe`, `ø` en `o`, `ß` en `ss`),
 * lettres d'allure trompeuse ramenées à celle qu'elles imitent (`LOOKALIKES`), en mots de lettres séparés d'une
 * espace. Toute lettre latine que le contrôle admet y devient une ou plusieurs lettres de `a` à `z`.
 */
export function letters(text: string): string {
  return text
    .normalize('NFKC')
    .replace(FORMAT, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .replace(LOOKALIKE, (char) => LOOKALIKES[char] ?? char)
    .replace(/[^\p{L}]+/gu, ' ')
    .trim();
}

/**
 * Lettres de même allure ramenées à une seule forme : `l` en `i` (et avec lui, par `letters`, toutes les lettres
 * de `LOOKALIKES`), `m` en `rn`, `w` en `vv`. Chaque lettre est remplacée seule, sans regarder ses voisines : un
 * nom se retrouve donc dans un texte dont il est un morceau.
 */
const skeleton = (word: string) => word.replace(/l/g, 'i').replace(/m/g, 'rn').replace(/w/g, 'vv');

/**
 * Noms de cité qu'un texte cite. Un nom d'au moins quatre lettres est cherché dans la suite de toutes les lettres
 * du texte, espaces retirées, ramenées à leur squelette : en mot entier, en début, en milieu ou en fin de mot
 * (« Kallistéens »), espacé ou ponctué lettre à lettre (« K.a.l.l.i.s.t.è »), ou d'allure trompeuse (« KaIIistè »
 * aux i capitales, « Kaʟʟıstè »). Un nom plus court n'est cherché qu'en mot entier.
 * Le prix de cette rigueur : un mot ou une suite de mots qui contient un nom par hasard (« halos ») fait rejeter
 * le texte, qui tombe sur le repli.
 */
export function cityNameIssues(text: string, cityNames: readonly string[]): string[] {
  const words = letters(text);
  const squeezed = skeleton(words.replace(/ /g, ''));
  const tokens = new Set(words.split(' ').map(skeleton));
  return cityNames.filter((name) => {
    const target = skeleton(letters(name).replace(/ /g, ''));
    if (target.length === 0) return false;
    return target.length >= SHORT_NAME ? squeezed.includes(target) : tokens.has(target);
  });
}

/** Chiffre romain valide, de 1 à 3 999, en minuscules. */
const ROMAN_NUMERAL = /^m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;
/** Mots courants qui sont aussi des chiffres romains valides : « celle-ci », « mi-chemin », « mix ». */
const ROMAN_WORDS: ReadonlySet<string> = new Set(['ci', 'mi', 'mix']);

/**
 * Chiffres romains en minuscules ou en casse mêlée (« xii », « Xii », « xıı ») qui forment à eux seuls un mot :
 * un mot d'au moins deux lettres, après le repliement des noms (`letters`), qui est un chiffre romain valide et
 * pas un mot courant (`ROMAN_WORDS`). Le contrôle de la chronique relève déjà ceux en capitales ; une suite de ces
 * lettres qui n'est pas un chiffre romain valide (« il », « mild », « civil ») est un mot, et passe. Rendus
 * repliés.
 */
export function romanNumerals(text: string): string[] {
  return letters(text)
    .split(' ')
    .filter((word) => word.length >= 2 && ROMAN_NUMERAL.test(word) && !ROMAN_WORDS.has(word));
}

/** Ce qui fait rejeter un oracle réécrit : vide, il ne cite ni nombre ni cité. */
export function oracleTextIssues(text: string, cityNames: readonly string[]): string[] {
  const folded = text.normalize('NFKC').replace(FORMAT, '');
  const visible = text.normalize('NFC').replace(FORMAT, '');
  return [
    // Lus avant le repliement, qui ferait de « ½ » un « 1⁄2 » : les deux formes sont relevées.
    ...[...visible.matchAll(DIGIT), ...folded.matchAll(DIGIT)].map(([match]) => match),
    ...writtenNumbers(text),
    ...romanNumerals(text),
    ...[...folded.matchAll(FIRST)].map(([match]) => match),
    ...[...folded.matchAll(NON_LATIN)].map(([match]) => match),
    ...[...folded.normalize('NFD').matchAll(UNUSUAL_LATIN)].map(([match]) => match),
    ...cityNameIssues(text, cityNames),
  ];
}

/**
 * Noms de cité qu'un oracle ne cite pas : ceux des fichiers de traduction de toutes les cités connues, puis les
 * identifiants courts et les noms en base des cités du monde (une cité sans traduction, ou renommée).
 */
export function oracleCityNames(cities: readonly { slug: string; name: string }[]): string[] {
  const known = [cityFr, cityEn].flatMap((locale) => Object.values(locale.cities));
  return [...new Set([...known, ...cities.flatMap((city) => [city.slug, city.name])])];
}

import { chronicleNumbers, type ChronicleFacts } from '@oikos/sim';
import type { ChronicleContext } from './compose';
import en from './locales/en.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };

/**
 * Nombres d'une chronique (règle 6, 8.1 ; #271) : une réécriture ne peut citer d'autre nombre que ceux des faits,
 * et seulement en chiffres latins. Tout autre façon d'écrire un nombre la fait rejeter : chiffres non latins ou
 * fractions (`\p{N}`), chiffres romains, nombres et quantités en lettres en français et en anglais, à partir de deux
 * (« un », « une », « one », « a » restent permis : ce sont aussi des articles).
 */

// Un nombre en chiffres latins : groupes de milliers séparés par une espace (ordinaire, insécable ou fine), une
// virgule, un point ou une apostrophe, puis une éventuelle partie décimale.
const NUMBER = /[0-9]+(?:[ \u00a0\u202f.,'’][0-9]{3}(?![0-9]))*(?:[.,][0-9]+)?/g;
const GROUPED = /^[0-9]+(?:[ \u00a0\u202f.,'’][0-9]{3})*$/;
/** Tout chiffre ou nombre Unicode qui n'est pas un chiffre latin : ٣, Ⅻ, ½, ², ３… */
const OTHER_DIGIT = /(?![0-9])\p{N}/gu;
/** Deux chiffres romains majuscules au moins, formant un mot, ordinal compris : XII, IVe, XIIth (I et V seuls sont des mots). */
const ROMAN =
  /(?<![\p{L}\p{N}])[IVXLCDM]{2,}(?:e|es|er|re|ème|èmes|nd|rd|th|st)?(?![\p{L}\p{N}])/gu;
const WORDS = [
  // Français : nombres, ordinaux en -ième, quantités.
  'z[ée]ro',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
  'vingts?',
  'trente',
  'quarante',
  'cinquante',
  'soixante',
  'septante',
  'octante',
  'huitante',
  'nonante',
  'cents?',
  'milles?',
  'millions?',
  'milliards?',
  '\\p{L}+i[èe]mes?',
  '(?:diz|douz|quinz|huit|neuv|vingt|trent|quarant|cinquant|soixant|cent)aines?',
  'milliers?',
  'moitiés?',
  'demie?s?',
  'tiers',
  'quarts?',
  'paires?',
  'secondes?',
  'myriades?',
  'si[èe]cles?',
  'd[ée]cennies?',
  'centenaires?',
  'mill[ée]naires?',
  // Racines communes : doubler, doublé, triplement, décupler, quintuplé…
  'doubl\\p{L}*',
  'tripl\\p{L}*',
  'quadrupl\\p{L}*',
  'quintupl\\p{L}*',
  'sextupl\\p{L}*',
  'septupl\\p{L}*',
  'octupl\\p{L}*',
  'd[ée]cupl\\p{L}*',
  'centupl\\p{L}*',
  // Anglais : nombres, ordinaux, quantités.
  'zero',
  'two',
  'three',
  'four',
  'five',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  '(?:thir|four|fif|six|seven|eigh|nine)teen(?:th)?s?',
  '(?:twen|thir|for|fif|six|seven|eigh|nine)t(?:y|ies|ieth)s?',
  'hundred(?:th)?s?',
  'thousand(?:th)?s?',
  'million(?:th)?s?',
  'billion(?:th)?s?',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'dozens?',
  'scores?',
  'half',
  'halves',
  'twice',
  'thrice',
  'quarters?',
  'thirds',
  'pairs?',
  'couples?',
  'seconds?',
  'both',
  'trios?',
  'duos?',
  'century',
  'centuries',
  'decades?',
  '\\p{L}*illions?',
  'nil',
  'nought',
  'naught',
  '\\p{L}+fold',
  'halv\\p{L}*',
];
const WORD = new RegExp(`(?<![\\p{L}\\p{N}])(?:${WORDS.join('|')})(?![\\p{L}\\p{N}])`, 'giu');

/** Caractères de format (espace sans largeur, trait d'union conditionnel…), invisibles : retirés avant le contrôle. */
const FORMAT = /\p{Cf}/gu;
/** Le texte tel qu'il se lit : accents composés, sans caractère de format. */
const visible = (text: string) => text.normalize('NFC').replace(FORMAT, '');
/** Le texte replié (NFKC) : lettres pleine chasse, ligatures et chiffres romains Unicode ramenés à leur forme simple. */
const folded = (text: string) => text.normalize('NFKC').replace(FORMAT, '');
/** Un mot qui mêle des lettres latines et des lettres d'une autre écriture (« dеux » au е cyrillique). */
const MIXED_SCRIPT = /[\p{L}\p{M}]+/gu;
const mixesScripts = (word: string) =>
  /\p{Script=Latin}/u.test(word) && /(?!\p{Script=Latin})\p{L}/u.test(word);

/**
 * Le texte, mis sous la forme `form`, débarrassé des noms donnés (sous la même forme) là où ils forment un mot
 * entier : « Vin » ne fait pas de « Vingt » un « gt ». Une cité ou un bien peuvent porter un mot de nombre.
 */
function withoutNames(text: string, names: readonly string[], form = folded): string {
  const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...names]
    .map(form)
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length)
    .reduce(
      (rest, name) =>
        rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'gu'), ' '),
      form(text),
    );
}

/**
 * Nombres écrits en chiffres latins dans un texte replié (NFKC), une fois retirés les noms donnés. Un nombre
 * décimal se lit `NaN` : il n'est jamais dans les faits, tous entiers.
 */
export function numbersInText(text: string, names: readonly string[] = []): number[] {
  return [...withoutNames(text, names).matchAll(NUMBER)].map(([match]) =>
    GROUPED.test(match) ? Number(match.replace(/[^0-9]/g, '')) : Number.NaN,
  );
}

/**
 * Nombres écrits autrement qu'en chiffres latins, tels qu'écrits : chiffres non latins et fractions (lus avant le
 * repliement, qui ferait de « ½ » un « 1⁄2 »), puis, dans le texte replié, chiffres romains, mots de nombre et mots
 * qui mêlent plusieurs écritures.
 */
export function writtenNumbers(text: string, names: readonly string[] = []): string[] {
  const bare = withoutNames(text, names);
  const others = [...withoutNames(text, names, visible).matchAll(OTHER_DIGIT)];
  const words = [ROMAN, WORD].flatMap((pattern) => [...bare.matchAll(pattern)]);
  const mixed = [...bare.matchAll(MIXED_SCRIPT)].filter(([word]) => mixesScripts(word));
  return [...others, ...words, ...mixed].map(([match]) => match);
}

/**
 * Ce qui fait rejeter un texte : chaque nombre en chiffres absent des faits (`NaN` pour un décimal), et chaque
 * nombre écrit autrement. Vide : le texte ne cite que des nombres des faits.
 */
export function numberIssues(
  text: string,
  facts: ChronicleFacts,
  names: readonly string[] = [],
): (number | string)[] {
  const allowed = chronicleNumbers(facts);
  return [
    ...numbersInText(text, names).filter((value) => !allowed.has(value)),
    ...writtenNumbers(text, names),
  ];
}

/**
 * Noms retirés d'un texte avant le contrôle : cités et biens de la configuration, puis cités en base et maisons élues
 * (écrites par des joueurs) dont le nom ne porte lui-même aucun nombre ni ne mêle plusieurs écritures. Une maison ou
 * une cité « Mille Oboles », « Deux Rives » ou « dеux » (е cyrillique) n'est pas retirée : une réécriture qui la cite
 * tombe sur le repli.
 */
export function chronicleNames(facts: ChronicleFacts, context: ChronicleContext): string[] {
  const allowed = chronicleNumbers(facts);
  const plain = (name: string) =>
    writtenNumbers(name).length === 0 && numbersInText(name).every((value) => allowed.has(value));
  return [
    ...[fr, en].flatMap((locale) => [
      ...Object.values(locale.cities),
      ...Object.values(locale.goods),
    ]),
    ...[...context.cityNames.values()].filter(plain),
    ...facts.elections.map((election) => election.houseName).filter(plain),
  ];
}

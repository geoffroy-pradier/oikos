import cityEn from '../chronicle/locales/en.json' with { type: 'json' };
import cityFr from '../chronicle/locales/fr.json' with { type: 'json' };
import { writtenNumbers } from '../chronicle/numbers';

/**
 * Contrôle d'un oracle réécrit (règle 6, 7.3 ; #270) : il ne cite aucun nombre, sous aucune forme, ni aucune cité.
 * Plus strict que celui de la chronique, qui admet les nombres de ses faits : un oracle n'en a aucun.
 * Ce qui fait rejeter un texte :
 * - tout caractère numérique Unicode (`\p{N}`) : chiffres latins ou non, chiffres romains Unicode, fractions,
 *   exposants ;
 * - tout nombre écrit autrement, relevé par le contrôle de la chronique (`writtenNumbers`) : nombres, ordinaux et
 *   quantités en lettres, en français et en anglais (à partir de deux), chiffres romains en capitales, mots qui
 *   mêlent plusieurs écritures ; plus « premier » et « first » ;
 * - toute lettre d'une autre écriture que l'écriture latine, ce qui écarte les lettres d'apparence latine (`е`
 *   cyrillique, `ο` grec) d'un nom de cité déguisé ;
 * - tout nom de cité (`cityNameIssues`).
 */

/** Caractères de format (espace sans largeur, trait d'union conditionnel…), invisibles. */
const FORMAT = /\p{Cf}/gu;
const DIGIT = /\p{N}/gu;
const NON_LATIN = /(?!\p{Script=Latin})\p{L}/gu;
const FIRST = /(?<![\p{L}\p{N}])(?:premi[eè]re?s?|first)(?![\p{L}\p{N}])/giu;
/** Au-dessous de cette longueur, un nom n'est cherché que comme mot entier, pas dans le texte serré. */
const SHORT_NAME = 4;

/**
 * Lettres d'un texte, pour y chercher un nom : repliement NFKC (pleine chasse, ligatures, exposants), sans
 * caractère de format, sans diacritique, en minuscules (`æ` en `ae`, `œ` en `oe`, `ø` en `o`, `ß` en `ss`), en
 * mots de lettres séparés d'une espace.
 */
function letters(text: string): string {
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
    .replace(/[^\p{L}]+/gu, ' ')
    .trim();
}

/**
 * Lettres de même allure ramenées à une seule forme : `l` et `ł` en `i`, `m` en `rn`, `w` en `vv`. Chaque lettre
 * est remplacée seule, sans regarder ses voisines : un nom se retrouve donc dans un texte dont il est un morceau.
 */
const skeleton = (word: string) =>
  word.replace(/[lł]/g, 'i').replace(/m/g, 'rn').replace(/w/g, 'vv');

/**
 * Noms de cité qu'un texte cite. Un nom d'au moins quatre lettres est cherché dans la suite de toutes les lettres
 * du texte, espaces retirées, ramenées à leur squelette : en mot entier, en début, en milieu ou en fin de mot
 * (« Kallistéens »), espacé ou ponctué lettre à lettre (« K.a.l.l.i.s.t.è »), ou d'allure trompeuse (« KaIIistè »
 * aux i capitales). Un nom plus court n'est cherché qu'en mot entier.
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

/** Ce qui fait rejeter un oracle réécrit : vide, il ne cite ni nombre ni cité. */
export function oracleTextIssues(text: string, cityNames: readonly string[]): string[] {
  const folded = text.normalize('NFKC').replace(FORMAT, '');
  const visible = text.normalize('NFC').replace(FORMAT, '');
  return [
    // Lus avant le repliement, qui ferait de « ½ » un « 1⁄2 » : les deux formes sont relevées.
    ...[...visible.matchAll(DIGIT), ...folded.matchAll(DIGIT)].map(([match]) => match),
    ...writtenNumbers(text),
    ...[...folded.matchAll(FIRST)].map(([match]) => match),
    ...[...folded.matchAll(NON_LATIN)].map(([match]) => match),
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

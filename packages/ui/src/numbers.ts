/**
 * Nombre saisi dans la langue de l'interface, écrit comme le formulaire affiche ses bornes : séparateur des
 * milliers de la langue ou espace de toute sorte entre groupes de trois chiffres (« 30 000 », « 30,000 » en
 * anglais), décimales après le séparateur de la langue (en français, la virgule ou le point). `null` : rien
 * de saisi ; `NaN` : saisie illisible, à dire comme telle plutôt que « hors des bornes ».
 */
export function readTypedNumber(typed: string, language: string): number | null {
  const split = splitTyped(typed, language);
  if (split === null) return null;
  if (split === undefined) return NaN;
  return Number(`${split.sign}${split.whole}.${split.fraction ?? '0'}`);
}

/**
 * Ce qu'une saisie a de refusé sur un champ entier (montant en oboles, durée en jours), en plus de
 * `readTypedNumber` : `ambiguous`, une partie décimale d'exactement trois chiffres (« 30,000 » ou « 30.000 »
 * en français), qui se lirait mille fois plus petite que les milliers que le joueur a pu vouloir écrire ;
 * `notInteger`, une autre saisie qui n'est pas un nombre entier (« 300,5 »). `null` : rien à redire ici
 * (rien de saisi, saisie illisible, nombre entier).
 */
export function typedIntegerProblem(
  typed: string,
  language: string,
): 'ambiguous' | 'notInteger' | null {
  const fraction = splitTyped(typed, language)?.fraction;
  if (fraction === undefined) return null;
  if (fraction.length === 3) return 'ambiguous';
  return Number.isInteger(readTypedNumber(typed, language)) ? null : 'notInteger';
}

/** Saisie découpée : signe, chiffres de la partie entière, décimales ; `null` : rien ; `undefined` : illisible. */
function splitTyped(typed: string, language: string) {
  const text = typed.trim();
  if (text === '') return null;
  const parts = new Intl.NumberFormat(language).formatToParts(12_345.6);
  const group = parts.find((part) => part.type === 'group')?.value ?? '';
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';
  const escape = (chars: string) => chars.replace(/[\\\]^-]/g, '\\$&');
  const groups = `[\\s${/\s/.test(group) ? '' : escape(group)}]`;
  const decimals = `[${escape(decimal === ',' && group !== '.' ? ',.' : decimal)}]`;
  const match = new RegExp(`^(-?)(\\d{1,3}(?:${groups}\\d{3})+|\\d+)(?:${decimals}(\\d+))?$`).exec(
    text,
  );
  if (!match) return undefined;
  const [, sign = '', whole = '', fraction] = match;
  return { sign, whole: whole.replace(/\D/g, ''), fraction };
}

/** Problème d'une saisie numérique, repéré à chaque frappe. */
export type NumberProblem = 'unreadable' | 'ambiguous' | 'notInteger' | 'belowMin' | 'aboveMax';

/**
 * Ce qu'une saisie a de refusé pour un champ à bornes et à pas (`NumberField`) ; `null` : rien de saisi,
 * ou un nombre acceptable. Un pas entier n'accepte que des nombres entiers (`typedIntegerProblem`).
 */
export function numberProblem(
  typed: string,
  language: string,
  { min, max, step = 1 }: { min?: number | undefined; max?: number | undefined; step?: number },
): NumberProblem | null {
  const value = readTypedNumber(typed, language);
  if (value === null) return null;
  if (Number.isNaN(value)) return 'unreadable';
  const integer = Number.isInteger(step) ? typedIntegerProblem(typed, language) : null;
  if (integer) return integer;
  if (min !== undefined && value < min) return 'belowMin';
  if (max !== undefined && value > max) return 'aboveMax';
  return null;
}

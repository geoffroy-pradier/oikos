import en from './locales/en.json';

type Row = Record<string, unknown>;
const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Champs d'un bien, dans l'ordre du formulaire. Un test vérifie qu'ils suivent le schéma. */
export const GOOD_FIELDS = [
  { key: 'id', kind: 'text' },
  { key: 'tier', kind: 'choice' },
  { key: 'referencePriceOboles', kind: 'integer' },
  { key: 'elasticity', kind: 'decimal' },
] as const;
export type GoodField = (typeof GOOD_FIELDS)[number];
/** Niveaux proposés : ceux qui ont un libellé. Un test vérifie qu'ils sont ceux du schéma. */
export const GOOD_TIERS = Object.keys(en.config.goodsForm.tiers);

/** Biens d'une configuration. Sans `goods` : liste vide. `null` : pas un objet dont `goods` est une liste d'objets. */
export function readGoods(config: unknown): Row[] | null {
  const goods = isRecord(config) && Object.hasOwn(config, 'goods') ? config['goods'] : [];
  return isRecord(config) && Array.isArray(goods) && goods.every(isRecord) ? goods : null;
}

// Entier : des chiffres seuls, sans zéro en tête. Décimal : point (ou virgule, voir `typed`), exposant.
const NUMBER = { integer: /^-?(0|[1-9]\d*)$/, decimal: /^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i };

/**
 * Valeur JSON d'une saisie, sans contrôle : l'API fait foi. `undefined` : champ vidé, la clé est retirée.
 * Jamais de valeur devinée : ce qui ne se lit pas comme un nombre reste un texte, que l'API refusera en
 * nommant le champ. Dans un prix, « 1.000 », « 1,000 », « 1e3 », « 5. » et « 007 » ne deviennent ni 1, ni
 * 1 000, ni 5, ni 7. Au-delà de 2^53 ou infini, JSON écrirait un autre nombre ou `null` : texte aussi.
 */
export function typed(kind: GoodField['kind'], input: string): unknown {
  if (input === '') return undefined;
  if (kind === 'text' || kind === 'choice') return input;
  const literal = (kind === 'decimal' ? input.replace(',', '.') : input).trim();
  const value = NUMBER[kind].test(literal) ? Number(literal) : NaN;
  const exact = Number.isInteger(value) ? Number.isSafeInteger(value) : Number.isFinite(value);
  return exact ? value : input;
}

/** Texte d'un champ. Une valeur d'un autre type que le sien est montrée en JSON (`"12"`, `null`), pas comme un nombre. */
export function shown(kind: GoodField['kind'], value: unknown): string {
  if (value === undefined) return '';
  const native = kind === 'integer' || kind === 'decimal' ? 'number' : 'string';
  return typeof value === native ? String(value) : JSON.stringify(value);
}

/** Biens après une saisie dans un champ : seule cette valeur change, les clés inconnues sont gardées. */
export function editGood(goods: Row[], row: number, field: GoodField, input: string): Row[] {
  const value = typed(field.kind, input);
  return goods.map((good, index) => {
    if (index !== row) return good;
    if (value !== undefined) return { ...good, [field.key]: value };
    return Object.fromEntries(Object.entries(good).filter(([key]) => key !== field.key));
  });
}

/** Texte JSON de la configuration avec ces biens : la seule chose que le formulaire écrit. */
export function composeGoods(config: unknown, goods: Row[]): string {
  return JSON.stringify({ ...(isRecord(config) ? config : {}), goods }, null, 2);
}

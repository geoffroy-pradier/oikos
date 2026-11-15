import en from './locales/en.json';

export type Row = Record<string, unknown>;
/** Champ d'une ligne de table : sa clé, et la façon dont une saisie s'y écrit (`typed`). */
export interface TableField {
  key: string;
  kind: 'text' | 'choice' | 'integer' | 'decimal';
}
const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Champs d'un bien, dans l'ordre du formulaire. Un test vérifie qu'ils suivent le schéma. */
export const GOOD_FIELDS = [
  { key: 'id', kind: 'text' },
  { key: 'tier', kind: 'choice' },
  { key: 'referencePriceOboles', kind: 'integer' },
  { key: 'elasticity', kind: 'decimal' },
] as const;
/** Niveaux proposés : ceux qui ont un libellé. Un test vérifie qu'ils sont ceux du schéma. */
export const GOOD_TIERS = Object.keys(en.config.goodsForm.tiers);

/** Lignes de la liste `key` d'un objet. Sans cette clé : liste vide. `null` : pas un objet dont `key` est une liste d'objets. */
export function readRows(value: unknown, key: string): Row[] | null {
  const rows = isRecord(value) && Object.hasOwn(value, key) ? value[key] : [];
  return isRecord(value) && Array.isArray(rows) && rows.every(isRecord) ? rows : null;
}
/** Biens d'une configuration (`readRows`). */
export const readGoods = (config: unknown) => readRows(config, 'goods');
/** L'objet avec cette liste à la clé `key` : à sa place si elle y était, sinon en dernier. Le reste est gardé. */
export const withRows = (value: unknown, key: string, rows: Row[]): Row => ({
  ...(isRecord(value) ? value : {}),
  [key]: rows,
});

// Entier : des chiffres seuls, sans zéro en tête. Décimal : point (ou virgule, voir `typed`), exposant.
const NUMBER = { integer: /^-?(0|[1-9]\d*)$/, decimal: /^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i };

/**
 * Valeur JSON d'une saisie, sans contrôle : l'API fait foi. `undefined` : champ vidé, la clé est retirée.
 * Jamais de valeur devinée : ce qui ne se lit pas comme un nombre reste un texte, que l'API refusera en
 * nommant le champ. Dans un prix, « 1.000 », « 1,000 », « 1e3 », « 5. » et « 007 » ne deviennent ni 1, ni
 * 1 000, ni 5, ni 7. Au-delà de 2^53 ou infini, JSON écrirait un autre nombre ou `null` : texte aussi.
 */
export function typed(kind: TableField['kind'], input: string): unknown {
  if (input === '') return undefined;
  if (kind === 'text' || kind === 'choice') return input;
  const literal = (kind === 'decimal' ? input.replace(',', '.') : input).trim();
  const value = NUMBER[kind].test(literal) ? Number(literal) : NaN;
  const exact = Number.isInteger(value) ? Number.isSafeInteger(value) : Number.isFinite(value);
  return exact ? value : input;
}

/** Texte d'un champ. Une valeur d'un autre type que le sien est montrée en JSON (`"12"`, `null`), pas comme un nombre. */
export function shown(kind: TableField['kind'], value: unknown): string {
  if (value === undefined) return '';
  const native = kind === 'integer' || kind === 'decimal' ? 'number' : 'string';
  return typeof value === native ? String(value) : JSON.stringify(value);
}

/** Lignes après une saisie dans un champ : seule cette valeur change, les clés inconnues sont gardées. */
export function editRow(rows: Row[], row: number, field: TableField, input: string): Row[] {
  const value = typed(field.kind, input);
  return rows.map((line, index) => {
    if (index !== row) return line;
    if (value !== undefined) return { ...line, [field.key]: value };
    return Object.fromEntries(Object.entries(line).filter(([key]) => key !== field.key));
  });
}

/** Texte JSON de la configuration avec cette table : la seule chose qu'un formulaire écrit. */
export const composeTable = (config: unknown, key: string, rows: Row[]): string =>
  JSON.stringify(withRows(config, key, rows), null, 2);
export const composeGoods = (config: unknown, goods: Row[]) => composeTable(config, 'goods', goods);

/**
 * Biens après un ajout : un objet vide en fin de liste, sans aucune valeur, pas même un niveau. Le
 * formulaire n'invente aucun paramètre : l'API refuse ce bien, champ par champ, tant qu'il n'est pas rempli.
 */
export const addGood = (goods: Row[]): Row[] => [...goods, {}];

/** Biens après le retrait d'un bien, désigné par son rang : les autres sont gardés, dans leur ordre. */
export const removeGood = (goods: Row[], row: number): Row[] =>
  goods.filter((_, index) => index !== row);

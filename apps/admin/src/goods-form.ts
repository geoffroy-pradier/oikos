import en from './locales/en.json';

export type Row = Record<string, unknown>;
/** Champ d'une ligne de table : sa clé, et la façon dont une saisie s'y écrit (`typed`). */
export interface TableField {
  key: string;
  kind: 'text' | 'choice' | 'integer' | 'decimal';
}
/** Une table dont chaque ligne porte des listes imbriquées, telle que son formulaire la montre. */
export interface NestedTable {
  /** Clé de la table dans la configuration, et de ses libellés (`config.schemaPath`). */
  table: string;
  /** Textes du formulaire : `config.<texts>.hint`, `unavailable`, `empty`, `add`, `remove`, `removed`. */
  texts: string;
  fields: readonly TableField[];
  lists: readonly { key: string; fields: readonly TableField[] }[];
  /** Choix proposés, par clé de champ : valeurs, et préfixe de leurs libellés. */
  choices: Record<string, { values: readonly string[]; labels: string }>;
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

/**
 * Lignes d'une table dont chaque ligne porte des listes imbriquées (`lists` : intrants et extrants d'une
 * recette, panier d'une classe). `null` aussi quand l'une d'elles, présente, n'est pas une liste d'objets :
 * un formulaire ne montre pas une ligne à moitié.
 */
export function readNested(config: unknown, key: string, lists: readonly string[]): Row[] | null {
  const rows = readRows(config, key);
  return rows?.every((row) => lists.every((list) => readRows(row, list))) ? rows : null;
}

/** Lignes après une saisie dans un élément de leur liste `list` : seule cette valeur change. */
export function editNested(
  rows: Row[],
  row: number,
  list: string,
  line: number,
  field: TableField,
  input: string,
): Row[] {
  return rows.map((entry, index) => {
    // Une liste absente n'est pas créée : il n'y a pas d'élément où saisir.
    const lines = index === row && Object.hasOwn(entry, list) ? readRows(entry, list) : null;
    return lines ? withRows(entry, list, editRow(lines, line, field, input)) : entry;
  });
}

/** Identifiants des biens du texte, sans doublon : de simples suggestions pour un champ « bien ». */
export function goodIds(config: unknown): string[] {
  const ids = (readRows(config, 'goods') ?? []).map((good) => good['id']);
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
}

/** Texte JSON de la configuration avec cette table : la seule chose qu'un formulaire écrit. */
export const composeTable = (config: unknown, key: string, rows: Row[]): string =>
  JSON.stringify(withRows(config, key, rows), null, 2);
export const composeGoods = (config: unknown, goods: Row[]) => composeTable(config, 'goods', goods);

/**
 * Lignes après un ajout : un objet vide en fin de liste, sans aucune valeur. Un formulaire n'invente aucun
 * paramètre : l'API refuse cette ligne, champ par champ, tant qu'elle n'est pas remplie.
 */
export const addRow = (rows: Row[]): Row[] => [...rows, {}];

/** Lignes après le retrait d'une ligne, désignée par son rang : les autres sont gardées, dans leur ordre. */
export const removeRow = (rows: Row[], row: number): Row[] =>
  rows.filter((_, index) => index !== row);

/** Lignes après un changement de la liste `list` de l'une d'elles ; une liste absente est créée en dernier. */
export const updateLines = (
  rows: Row[],
  row: number,
  list: string,
  change: (lines: Row[]) => Row[],
) =>
  rows.map((entry, index) =>
    index === row ? withRows(entry, list, change(readRows(entry, list) ?? [])) : entry,
  );

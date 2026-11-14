import { z } from 'zod';

/** Montant en oboles : entier sûr (`int` refuse au-delà de 2^53), sinon la ligne est illisible. */
const obols = z.number().int();
const sheetSchema = z.object({
  treasury: obols,
  escrow: obols,
  stock_value: obols.nonnegative(),
  unpriced_stocks: z.number().int().nonnegative(),
});

/** Bilan de la maison (vue `my_balance_sheet`), en oboles. */
export interface BalanceSheet {
  treasury: number;
  escrow: number;
  /** Valeur des stocks qui ont un prix observé ; `unpricedStocks` compte ceux qu'elle ignore. */
  stockValue: number;
  unpricedStocks: number;
  /** Trésorerie, séquestre et stocks valorisés : l'actif connu de la maison. */
  total: number;
}

/** `null` si la ligne manque ou est illisible : jamais pris pour un bilan nul. */
export function parseBalanceSheet(raw: unknown): BalanceSheet | null {
  const parsed = sheetSchema.safeParse(raw);
  if (!parsed.success) return null;
  const {
    treasury,
    escrow,
    stock_value: stockValue,
    unpriced_stocks: unpricedStocks,
  } = parsed.data;
  const total = treasury + escrow + stockValue;
  return Number.isSafeInteger(total)
    ? { treasury, escrow, stockValue, unpricedStocks, total }
    : null;
}

const stockSchema = z
  .object({
    city_id: z.string().min(1),
    good_id: z.string().min(1),
    quantity: z.number().int().positive(),
    unit_price: obols.positive().nullable(),
    value: obols.positive().nullable(),
    priced_at: z.iso.datetime({ offset: true }).nullable(),
  })
  // Un prix, sa date et la valeur vont ensemble : jamais de valeur sans prix, ni de prix sans valeur.
  .refine((s) => [s.value, s.priced_at].every((v) => (v === null) === (s.unit_price === null)));

/** Un stock valorisé (vue `my_valued_stocks`) ; sans prix observé, ni prix, ni valeur, ni date. */
export interface ValuedStock {
  cityId: string;
  goodId: string;
  quantity: number;
  unitPrice: number | null;
  value: number | null;
  /** Instant du calcul du prix, en millisecondes. */
  pricedAt: number | null;
}

/** Stocks dans l'ordre de lecture. `null` si une ligne est illisible : jamais pris pour « aucun stock ». */
export function parseValuedStocks(raw: unknown): ValuedStock[] | null {
  const parsed = z.array(stockSchema).safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.map((stock) => ({
    cityId: stock.city_id,
    goodId: stock.good_id,
    quantity: stock.quantity,
    unitPrice: stock.unit_price,
    value: stock.value,
    pricedAt: stock.priced_at === null ? null : Date.parse(stock.priced_at),
  }));
}

/**
 * Tri d'un tableau de comptes, sans toucher aux lignes reçues : nombres par valeur, textes dans l'ordre
 * de la langue. Une valeur absente (`null`) reste à la fin dans les deux sens ; à valeur égale, l'ordre
 * reçu est gardé.
 */
export function sortRows<T>(
  rows: readonly T[],
  key: (row: T) => number | string | null,
  descending: boolean,
  language: string,
): T[] {
  const collator = new Intl.Collator(language);
  return [...rows].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    if (x === null || y === null) return Number(x === null) - Number(y === null);
    const order =
      typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(`${x}`, `${y}`);
    return descending ? -order : order;
  });
}

/** Colonnes de montants du compte de résultat, nommées comme dans ses vues (4.1), en oboles. */
const OPERATING = ['sales', 'purchases', 'taxes', 'upkeep', 'operating_result'] as const;
const NON_OPERATING = ['acquisitions', 'grants', 'other', 'non_operating'] as const;
export const INCOME_COLUMNS = [
  ...OPERATING,
  ...NON_OPERATING,
  'cash_change',
  'escrow_change',
] as const;
export type IncomeColumn = (typeof INCOME_COLUMNS)[number];
/**
 * Une période du compte de résultat : un jour de jeu (`my_income_statement`) ou une saison
 * (`my_income_statement_by_season`), du premier au dernier jour de jeu. `null` : horloge inconnue.
 */
export type IncomeRow = Record<IncomeColumn, number> & {
  firstDay: number | null;
  lastDay: number | null;
};

const gameDay = z.number().int().nullable();
const amount = Object.fromEntries(INCOME_COLUMNS.map((column) => [column, obols]));
const amounts = z.object(amount as Record<IncomeColumn, typeof obols>);
const incomeSchema = z.union([
  amounts
    .extend({ game_day: gameDay })
    .transform((row) => ({ ...row, firstDay: row.game_day, lastDay: row.game_day })),
  amounts
    .extend({ first_game_day: gameDay, last_game_day: gameDay })
    .transform((row) => ({ ...row, firstDay: row.first_game_day, lastDay: row.last_game_day })),
]);

/**
 * Lignes du compte de résultat, par jour ou par saison, dans l'ordre de lecture. `null` si une ligne est
 * illisible ou si ses totaux ne tombent pas juste (exploitation, hors exploitation, variation de la
 * monnaie) : un compte faux n'est pas affiché, et n'est jamais pris pour « aucun mouvement ».
 */
export function parseIncomeStatement(raw: unknown): IncomeRow[] | null {
  const parsed = z.array(incomeSchema).safeParse(raw);
  if (!parsed.success) return null;
  const sound = (row: IncomeRow) =>
    row.sales + row.purchases + row.taxes + row.upkeep === row.operating_result &&
    row.acquisitions + row.grants + row.other === row.non_operating &&
    row.operating_result + row.non_operating === row.cash_change &&
    (row.firstDay === null) === (row.lastDay === null) &&
    (row.firstDay ?? 0) <= (row.lastDay ?? 0);
  return parsed.data.every(sound) ? parsed.data : null;
}

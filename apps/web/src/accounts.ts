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

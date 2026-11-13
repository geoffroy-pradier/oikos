/**
 * Grand livre en partie double : fonctions pures, sans entrée-sortie.
 * Montants en oboles entières. Positif : crédit du compte ; négatif : débit.
 */

/** Comptes système : un par robinet (création de monnaie) et par puits (destruction), spécification 5.5. */
export const SYSTEM_ACCOUNT_KEYS = [
  'faucet_npc_purchases',
  'faucet_temple_loans',
  'faucet_rewards',
  'faucet_starting_grant',
  'sink_npc_wages',
  'sink_upkeep',
  'sink_market_tax',
  'sink_offerings',
  'sink_temple_interest',
  'sink_public_works',
] as const;
export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[number];

export interface LedgerLine {
  accountId: string;
  amount: number;
}

export interface LedgerEntry {
  /** Nature de l'écriture, par exemple `npc_purchase`. */
  kind: string;
  lines: readonly LedgerLine[];
}

export type LedgerErrorCode =
  'TOO_FEW_LINES' | 'INVALID_AMOUNT' | 'UNBALANCED' | 'INSUFFICIENT_FUNDS' | 'OVERFLOW';

export type Result<T> =
  { ok: true; value: T } | { ok: false; error: LedgerErrorCode; accountId?: string };

const fail = (error: LedgerErrorCode, accountId?: string): Result<never> =>
  accountId === undefined ? { ok: false, error } : { ok: false, error, accountId };

/** Un montant ou une quantité valide : entier sûr, jamais de flottant. */
function isAmount(value: number): boolean {
  return Number.isSafeInteger(value);
}

/** Construit une écriture équilibrée : au moins deux lignes, montants entiers non nuls, somme nulle. */
export function buildEntry(kind: string, lines: readonly LedgerLine[]): Result<LedgerEntry> {
  if (lines.length < 2) return fail('TOO_FEW_LINES');
  let sum = 0;
  for (const line of lines) {
    if (!isAmount(line.amount) || line.amount === 0) return fail('INVALID_AMOUNT', line.accountId);
    sum += line.amount;
    if (!isAmount(sum)) return fail('OVERFLOW');
  }
  if (sum !== 0) return fail('UNBALANCED');
  return { ok: true, value: { kind, lines: lines.map((line) => ({ ...line })) } };
}

/** Écriture à deux lignes : `amount` oboles passent de `from` à `to`. */
export function transfer(
  kind: string,
  from: string,
  to: string,
  amount: number,
): Result<LedgerEntry> {
  if (!isAmount(amount) || amount <= 0) return fail('INVALID_AMOUNT', from);
  return buildEntry(kind, [
    { accountId: from, amount: -amount },
    { accountId: to, amount },
  ]);
}

export type Balances = ReadonlyMap<string, number>;

/**
 * Applique une écriture à des soldes. Tout ou rien : en cas de refus, les soldes fournis sont inchangés.
 * `mayOverdraw` dit quels comptes peuvent être débiteurs (les comptes système).
 */
export function applyEntry(
  balances: Balances,
  entry: LedgerEntry,
  mayOverdraw: (accountId: string) => boolean,
): Result<Balances> {
  const checked = buildEntry(entry.kind, entry.lines);
  if (!checked.ok) return checked;
  const next = new Map(balances);
  for (const line of entry.lines) {
    const balance = (next.get(line.accountId) ?? 0) + line.amount;
    if (!isAmount(balance)) return fail('OVERFLOW', line.accountId);
    next.set(line.accountId, balance);
  }
  // Le découvert se juge sur le solde final : plusieurs lignes peuvent toucher le même compte.
  for (const [accountId, balance] of next) {
    if (balance < 0 && balance !== balances.get(accountId) && !mayOverdraw(accountId)) {
      return fail('INSUFFICIENT_FUNDS', accountId);
    }
  }
  return { ok: true, value: next };
}

/** Masse monétaire : somme des soldes hors comptes système, soit l'opposé du cumul des comptes système. */
export function moneySupply(balances: Balances, isSystem: (accountId: string) => boolean): number {
  let total = 0;
  for (const [accountId, balance] of balances) if (!isSystem(accountId)) total += balance;
  return total;
}

// ------------------------------------------------------------------------------------------- Stocks

/** Extrémité d'un mouvement de stock : un stock de joueur, ou une source/un puits système nommé. */
export type StockEnd = { inventoryId: string } | { system: string };

export interface StockMovement {
  goodId: string;
  quantity: number;
  from: StockEnd;
  to: StockEnd;
}

export type StockErrorCode =
  'INVALID_QUANTITY' | 'NO_INVENTORY' | 'SAME_INVENTORY' | 'INSUFFICIENT_STOCK' | 'OVERFLOW';
export type StockResult = { ok: true; value: Quantities } | { ok: false; error: StockErrorCode };
export type Quantities = ReadonlyMap<string, number>;

/** Applique un mouvement de stock. Tout ou rien ; une quantité ne devient jamais négative. */
export function applyStockMovement(quantities: Quantities, movement: StockMovement): StockResult {
  const { from, to, quantity } = movement;
  if (!isAmount(quantity) || quantity <= 0) return { ok: false, error: 'INVALID_QUANTITY' };
  const origin = 'inventoryId' in from ? from.inventoryId : null;
  const destination = 'inventoryId' in to ? to.inventoryId : null;
  if (origin === null && destination === null) return { ok: false, error: 'NO_INVENTORY' };
  if (origin !== null && origin === destination) return { ok: false, error: 'SAME_INVENTORY' };

  const next = new Map(quantities);
  if (origin !== null) {
    const remaining = (next.get(origin) ?? 0) - quantity;
    if (remaining < 0) return { ok: false, error: 'INSUFFICIENT_STOCK' };
    next.set(origin, remaining);
  }
  if (destination !== null) {
    const total = (next.get(destination) ?? 0) + quantity;
    if (!isAmount(total)) return { ok: false, error: 'OVERFLOW' };
    next.set(destination, total);
  }
  return { ok: true, value: next };
}

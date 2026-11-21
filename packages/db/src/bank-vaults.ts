import { sql, type Kysely } from 'kysely';

/** Coffre d'une banque de joueur (docs/specs/05-economie.md, 5.4 ; #726) : son compte et son solde. */
export interface BankVault {
  accountId: string;
  balance: number;
}

/**
 * Verrouille le coffre d'une banque et le rend ; `null` pour une banque inconnue. Le service ne voit pas les coffres
 * dans `game.accounts` (migration 9940) : il les prend par cette fonction de la base, après la trésorerie de la maison.
 */
export async function lockBankVault<T>(db: Kysely<T>, bankId: string): Promise<BankVault | null> {
  const { rows } = await sql<{ account_id: string; balance: string }>`
    select account_id, balance from game.lock_bank_vault(${bankId}::uuid)`.execute(db);
  const [row] = rows;
  return row ? { accountId: row.account_id, balance: Number(row.balance) } : null;
}

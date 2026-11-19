import { sql, type Kysely } from 'kysely';

/** Bourse des PNJ d'une cité (docs/specs/05-economie.md, 5.2 et 5.5 ; #632) : son compte et son solde. */
export interface NpcPurse {
  cityId: string;
  accountId: string;
  balance: number;
}

/**
 * Verrouille les bourses des PNJ d'un monde, ou celle d'une de ses cités, dans l'ordre des cités, et les rend
 * par cité. Le service ne voit pas les bourses dans `game.accounts` (migration 1100) : il les prend par cette
 * fonction de la base. Ordre des verrous (5.5) : après le verrou de l'agora et les puits de l'entretien, avant
 * toute trésorerie de maison.
 */
export async function lockNpcPurses<T>(
  db: Kysely<T>,
  worldId: string,
  cityId?: string,
): Promise<Map<string, NpcPurse>> {
  const { rows } = await sql<{ city_id: string; account_id: string; balance: string }>`
    select city_id, account_id, balance from game.lock_npc_purses(${worldId}::uuid, ${cityId ?? null}::uuid)`.execute(
    db,
  );
  return new Map(
    rows.map((row) => [
      row.city_id,
      { cityId: row.city_id, accountId: row.account_id, balance: Number(row.balance) },
    ]),
  );
}

import type { Db } from '@oikos/db';
import { sql } from 'kysely';

/**
 * Ce qu'ont en commun une offrande (`temple.makeOffering`) et une consultation de la Pythie (`temple.consultOracle`),
 * qui en est une (7.1, 7.3) : l'ordre des verrous, et l'écriture de l'offrande, de ses oboles et de sa Charis.
 */

/**
 * Verrous d'une offrande, la maison déjà verrouillée (`FOR NO KEY UPDATE`) : sa Charis envers le dieu, puis l'agora
 * du monde, puis la trésorerie si elle donne des oboles. La Charis est prise AVANT l'agora : le déclin de la clôture
 * verrouille les Charis sans l'agora, puis la prend aux étapes suivantes ; dans l'ordre inverse, la commande et la
 * clôture s'attendraient l'une l'autre. Rend la trésorerie et son solde, ou `null` sans oboles.
 */
export async function lockOffering(
  trx: Db,
  house: { id: string; world_id: string },
  godId: string,
  oboles: number,
): Promise<{ id: string; balance: number } | null> {
  await trx
    .selectFrom('game.favor')
    .select('charis')
    .where('house_id', '=', house.id)
    .where('god_id', '=', godId)
    .forUpdate()
    .execute();
  const agora = `market:${house.world_id}`;
  await sql`select pg_advisory_xact_lock(hashtextextended(${agora}, 0))`.execute(trx);
  if (oboles === 0) return null;
  const account = await trx
    .selectFrom('game.accounts')
    .select(['id', 'balance'])
    .where('house_id', '=', house.id)
    .where('kind', '=', 'house')
    .forUpdate()
    .executeTakeFirstOrThrow();
  return { id: account.id, balance: Number(account.balance) };
}

/**
 * Écrit une offrande : ses oboles, s'il y en a, de la trésorerie au puits `sink_offerings` par une écriture `kind`
 * (`temple.offering`, ou `temple.oracle` pour une consultation), l'offrande, et sa Charis au journal. Les biens
 * offerts sont l'affaire de l'appelant. Rend l'identifiant de l'offrande.
 */
export async function writeOffering(
  trx: Db,
  offering: {
    worldId: string;
    houseId: string;
    cityId: string;
    godId: string;
    oboles: number;
    charis: number;
    treasuryId: string | null;
    kind: 'temple.offering' | 'temple.oracle';
  },
): Promise<string> {
  const { worldId, houseId, godId, oboles, treasuryId } = offering;
  let entryId: string | null = null;
  if (treasuryId !== null && oboles > 0) {
    const sink = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', worldId)
      .where('system_key', '=', 'sink_offerings')
      .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no sink_offerings`));
    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({ world_id: worldId, kind: offering.kind, meta: JSON.stringify({ houseId, godId }) })
      .returning('id')
      .executeTakeFirstOrThrow();
    entryId = entry.id;
    await trx
      .insertInto('game.ledger_lines')
      .values([
        { entry_id: entry.id, account_id: treasuryId, amount: -oboles },
        { entry_id: entry.id, account_id: sink.id, amount: oboles },
      ])
      .execute();
  }
  const row = await trx
    .insertInto('game.offerings')
    .values({
      world_id: worldId,
      house_id: houseId,
      city_id: offering.cityId,
      god_id: godId,
      oboles,
      charis: offering.charis,
      ledger_entry_id: entryId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('game.favor_ledger')
    .values({
      world_id: worldId,
      house_id: houseId,
      god_id: godId,
      amount: offering.charis,
      kind: 'offering',
      offering_id: row.id,
    })
    .execute();
  return row.id;
}

/** Charis de la maison envers un dieu, journal compris. */
export async function charisOf(trx: Db, houseId: string, godId: string): Promise<number> {
  const row = await trx
    .selectFrom('game.favor')
    .select('charis')
    .where('house_id', '=', houseId)
    .where('god_id', '=', godId)
    .executeTakeFirstOrThrow();
  return Number(row.charis);
}

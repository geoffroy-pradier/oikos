import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { GameDatabase } from '@oikos/db';
import { afterAll, describe, expect, it } from 'vitest';
import { db, owner } from './chat-test-world';

// Migration 600 (#604) contre Supabase local, jouée comme par un déploiement sur une base d'avant elle où un compte a
// déjà une maison dans deux mondes, dans une transaction annulée à la fin.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/supabase/migrations/20261118000600_houses_one_per_account.sql',
    import.meta.url,
  ),
  'utf8',
);
const ROLLBACK = new Error('rollback');

describe('migration 600 : une maison par compte (#604)', () => {
  it('passe sur un compte qui a déjà deux maisons, sans en retirer ; rejouée, ne change rien ; refuse la troisième', async () => {
    const run = owner.transaction().execute(async (trx: Transaction<GameDatabase>) => {
      // La base telle qu'avant la migration ; le troisième monde n'a aucune maison d'Alice.
      await sql`drop trigger houses_one_per_account on game.houses;
        drop function game.houses_one_per_account(); drop index game.houses_user_id_idx`.execute(
        trx,
      );
      const [alice, worlds] = [randomUUID(), [randomUUID(), randomUUID(), randomUUID()]];
      await sql`insert into auth.users (id, email) values (${alice}, ${`${alice}@example.test`})`.execute(
        trx,
      );
      for (const [index, worldId] of worlds.entries()) {
        await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`m-${worldId.slice(0, 12)}`}, 'Test')`.execute(
          trx,
        );
        if (index < 2)
          await sql`insert into game.houses (world_id, user_id, name, blazon)
            values (${worldId}, ${alice}, ${`Héritée ${'ab'[index]}`}, '{}')`.execute(trx);
      }
      const houses = async () =>
        (
          await sql<{
            name: string;
          }>`select name from game.houses where user_id = ${alice} order by name`.execute(trx)
        ).rows;

      await sql.raw(MIGRATION).execute(trx);
      await sql.raw(MIGRATION).execute(trx);
      expect(await houses()).toEqual([{ name: 'Héritée a' }, { name: 'Héritée b' }]);
      await sql`savepoint third`.execute(trx);
      await expect(
        sql`insert into game.houses (world_id, user_id, name, blazon)
          values (${worlds[2]}, ${alice}, 'Troisième', '{}')`.execute(trx),
      ).rejects.toMatchObject({ code: '23505', constraint: 'houses_one_per_user' });
      await sql`rollback to savepoint third`.execute(trx);
      expect(await houses()).toHaveLength(2);
      throw ROLLBACK;
    });
    await expect(run).rejects.toBe(ROLLBACK);
  });
});

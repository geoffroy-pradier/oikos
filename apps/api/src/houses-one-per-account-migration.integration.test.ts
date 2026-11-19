import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { GameDatabase } from '@oikos/db';
import { afterAll, describe, expect, it } from 'vitest';
import { db, owner } from './chat-test-world';

// Migration 600 (#604) contre Supabase local : un compte n'a plus qu'une maison dans tout le jeu. Elle est jouée comme
// par un déploiement, dans une transaction annulée à la fin, sur une table rendue à l'unicité par monde et par compte.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/supabase/migrations/20261118000600_houses_one_per_account.sql',
    import.meta.url,
  ),
  'utf8',
);
const ROLLBACK = new Error('rollback');

/** Exécute `body` dans une transaction du propriétaire, toujours annulée. */
const inRolledBack = (body: (trx: Transaction<GameDatabase>) => Promise<void>) =>
  owner
    .transaction()
    .execute(async (trx) => {
      await body(trx);
      throw ROLLBACK;
    })
    .catch((error: unknown) => {
      if (error !== ROLLBACK) throw error;
    });

const constraintOf = async (trx: Transaction<GameDatabase>) =>
  (
    await sql<{ oid: number; def: string }>`select oid::int, pg_get_constraintdef(oid) as def
      from pg_constraint where conrelid = 'game.houses'::regclass and conname = 'houses_one_per_user'`.execute(
      trx,
    )
  ).rows;

/** Joue la migration dans un point de reprise : rend l'erreur, ou null, et annule ses effets en cas d'erreur. */
const migrate = async (trx: Transaction<GameDatabase>) => {
  await sql`savepoint migration`.execute(trx);
  try {
    await sql.raw(MIGRATION).execute(trx);
    return null;
  } catch (error) {
    await sql`rollback to savepoint migration`.execute(trx);
    return error as { code?: string; message?: string };
  }
};

describe('migration 600 : une maison par compte (#604)', () => {
  it('refuse, sans rien supprimer, un compte qui a déjà deux maisons ; passe une fois le doublon résolu ; rejouée, ne change rien', async () => {
    await inRolledBack(async (trx) => {
      // La table telle qu'avant la migration : une maison par monde et par compte.
      await sql`alter table game.houses drop constraint houses_one_per_user`.execute(trx);
      await sql`alter table game.houses add constraint houses_one_per_user unique (world_id, user_id)`.execute(
        trx,
      );
      const [alice, worlds] = [randomUUID(), [randomUUID(), randomUUID()]];
      await sql`insert into auth.users (id, email) values (${alice}, ${`${alice}@example.test`})`.execute(
        trx,
      );
      for (const [index, worldId] of worlds.entries()) {
        await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`m-${worldId.slice(0, 12)}`}, 'Test')`.execute(
          trx,
        );
        await sql`insert into game.houses (world_id, user_id, name, blazon)
          values (${worldId}, ${alice}, ${`Doublon ${'ab'[index]}`}, '{}')`.execute(trx);
      }
      const houses = () =>
        sql<{
          n: number;
        }>`select count(*)::int as n from game.houses where user_id = ${alice}`.execute(trx);

      const refused = await migrate(trx);
      expect(refused).toMatchObject({ code: '23505' });
      expect(refused?.message).toContain('1 account(s) own several houses');
      expect((await houses()).rows).toEqual([{ n: 2 }]);
      expect((await constraintOf(trx)).map(({ def }) => def)).toEqual([
        'UNIQUE (world_id, user_id)',
      ]);

      // Un humain a tranché : la seconde maison passe à un autre compte. La migration passe alors.
      const bob = randomUUID();
      await sql`insert into auth.users (id, email) values (${bob}, ${`${bob}@example.test`})`.execute(
        trx,
      );
      await sql`update game.houses set user_id = ${bob} where user_id = ${alice} and world_id = ${worlds[1]}`.execute(
        trx,
      );
      expect(await migrate(trx)).toBeNull();
      const applied = await constraintOf(trx);
      expect(applied.map(({ def }) => def)).toEqual(['UNIQUE (user_id)']);
      expect(await migrate(trx)).toBeNull();
      expect(await constraintOf(trx)).toEqual(applied);
      await sql`savepoint second`.execute(trx);
      await expect(
        sql`insert into game.houses (world_id, user_id, name, blazon)
          values (${worlds[1]}, ${alice}, 'Troisième', '{}')`.execute(trx),
      ).rejects.toMatchObject({ code: '23505', constraint: 'houses_one_per_user' });
      await sql`rollback to savepoint second`.execute(trx);
    });
  });
});

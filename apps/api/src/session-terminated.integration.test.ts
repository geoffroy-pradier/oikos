import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand, executeCommand, type CommandResult } from './registry';
import { testConfig } from './test-config';

// Une session de base fermée en cours de commande (redémarrage, bascule, `pg_terminate_backend`) ne fait
// échouer que cette commande : le processus reste vivant, la trace d'audit est écrite par une autre
// connexion et la clé d'idempotence reste utilisable (ticket #136).
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const WORLD_ID = '01900000-0000-7000-8000-000000000001';
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Commande d'essai : renomme la maison du compte ; `cut` fait fermer sa session par la base avant la fin. */
const rename = defineCommand({
  name: 'test.renameThenCut',
  input: z.strictObject({ name: z.string(), cut: z.boolean() }),
  output: z.strictObject({ name: z.string() }),
  errors: [],
  async handler(context, input): Promise<CommandResult<{ name: string }>> {
    await context.trx
      .updateTable('game.houses')
      .set({ name: input.name })
      .where('user_id', '=', context.userId)
      .execute();
    if (input.cut) {
      // Une autre connexion termine la session de la commande, comme le ferait un redémarrage.
      const pid = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(context.trx);
      await sql`select pg_terminate_backend(${pid.rows[0]?.pid ?? 0})`.execute(owner);
      await sql`select 1`.execute(context.trx);
    }
    return { ok: true, data: { name: input.name } };
  },
});

it('session terminée en cours de commande : INTERNAL, trace écrite, clé réutilisable, rien de validé', async () => {
  const userId = randomUUID();
  const letters = [...userId.replace(/[^a-f]/g, '')].slice(0, 10).join('');
  await sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`.execute(
    owner,
  );
  await db
    .insertInto('game.houses')
    .values({ world_id: WORLD_ID, user_id: userId, name: `Coupure ${letters}`, blazon: '{}' })
    .execute();
  const key = randomUUID();
  const request = (cut: boolean) => ({
    userId,
    idempotencyKey: key,
    input: { name: `Rebaptisée ${letters}`, cut },
  });

  const cut = await executeCommand(db, rename, request(true), testConfig);
  expect(cut).toEqual({
    response: { ok: false, error: { code: 'INTERNAL', message: 'Unexpected error.' } },
    replayed: false,
  });
  // Rien n'est validé : le renommage a été annulé avec la session.
  const before = await db
    .selectFrom('game.houses')
    .select('name')
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();
  expect(before.name).toBe(`Coupure ${letters}`);
  // La trace d'audit est écrite, sans clé : la commande pourra être rejouée avec la même.
  const log = await db
    .selectFrom('game.command_log')
    .select(['status', 'error_code', 'idempotency_key'])
    .where('user_id', '=', userId)
    .execute();
  expect(log).toEqual([{ status: 'failed', error_code: 'INTERNAL', idempotency_key: null }]);

  // Le pool a écarté la connexion morte : la même clé aboutit, une seule fois.
  const retried = await executeCommand(db, rename, request(false), testConfig);
  expect(retried).toEqual({
    response: { ok: true, data: { name: `Rebaptisée ${letters}` } },
    replayed: false,
  });
  const replayed = await executeCommand(db, rename, request(false), testConfig);
  expect(replayed.replayed).toBe(true);
});

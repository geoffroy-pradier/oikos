import { createDb, SERVICE_ROLE, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, expect, it } from 'vitest';

// La connexion des services (API, moteur) agit sous le rôle de service : les autres tests d'intégration
// reposent sur cette adresse, ce test en fixe les propriétés.
const db = createDb(
  serviceRoleUrl(
    process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  ),
);
afterAll(() => db.destroy());

it('chaque connexion du pool prend le rôle de service', async () => {
  const roles = await Promise.all(
    Array.from({ length: 6 }, () =>
      sql<{ role: string }>`select current_user::text as role, pg_sleep(0.05)`.execute(db),
    ),
  );
  expect(new Set(roles.map((result) => result.rows[0]?.role))).toEqual(new Set([SERVICE_ROLE]));
});

it('une adresse qui porte déjà des options garde le reste et prend le rôle', () => {
  const url = new URL(serviceRoleUrl('postgresql://u:p@db.internal:5432/app?sslmode=require'));
  expect(url.searchParams.get('sslmode')).toBe('require');
  expect(url.searchParams.get('options')).toBe(`-c role=${SERVICE_ROLE}`);
  expect(`${url.host}${url.pathname}`).toBe('db.internal:5432/app');
});

it.each([
  ['supprimer une écriture', sql`delete from game.ledger_lines`, '42501'],
  ['vider un journal', sql`truncate game.stock_ledger`, '42501'],
  ['modifier un solde', sql`update game.accounts set balance = balance + 1`, '23001'],
  ['modifier un stock', sql`update game.inventories set quantity = quantity + 1`, '23001'],
  ['lire les comptes des joueurs', sql`select 1 from auth.users`, '42501'],
  [
    "s'accorder un rôle",
    sql`insert into admin.roles (user_id, role) select id, 'super_admin' from game.houses`,
    '42501',
  ],
])('le service ne peut pas %s', async (_label, statement, code) => {
  await expect(statement.execute(db)).rejects.toMatchObject({ code });
});

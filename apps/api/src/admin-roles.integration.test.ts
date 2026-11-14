import { randomUUID } from 'node:crypto';
import { ADMIN_ROLES, type AdminRole } from '@oikos/contracts';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { testConfig, testVerifier } from './test-config';

// Tests d'intégration des commandes `admin.grantRole` et `admin.revokeRole`, contre Supabase local.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const app = createApp({
  db,
  telemetry: createTelemetry(db),
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

async function newUser(role: AdminRole | null = null, grantedBy: string | null = null) {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  if (role) await sql`insert into admin.roles values (${id}, ${role}, ${grantedBy})`.execute(owner);
  return id;
}
let root: string;
beforeAll(async () => {
  root = await newUser('super_admin');
});

const send = async (
  user: string,
  command: 'admin.grantRole' | 'admin.revokeRole',
  body: unknown,
  { aal2 = true, key = randomUUID() as string } = {},
) => {
  const res = await app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${aal2 ? 'aal2:' : ''}${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    replayed: res.headers.get('Idempotent-Replay'),
    body: await res.json(),
  };
};
const roleOf = (userId: string) =>
  db
    .selectFrom('admin.roles')
    .select(['role', 'granted_by'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
const eventsOf = (userId: string) =>
  db
    .selectFrom('game.domain_events as e')
    .innerJoin('game.command_log as l', 'l.id', 'e.command_id')
    .select(['l.command', 'l.admin_role', 'e.type', 'e.payload'])
    .where('l.user_id', '=', userId)
    .orderBy('e.id')
    .execute();
const superAdmins = async () =>
  (await db.selectFrom('admin.roles').select('user_id').where('role', '=', 'super_admin').execute())
    .map((row) => row.user_id)
    .sort();
/**
 * Les autres suites laissent leurs super-administrateurs dans la base partagée. Le temps d'un test sur
 * « le dernier », tous les rôles sauf ceux de `kept` sont mis de côté, puis rendus tels quels.
 */
async function alone(kept: string[], run: () => Promise<void>) {
  const aside = await owner
    .deleteFrom('admin.roles')
    .where('user_id', 'not in', kept)
    .returningAll()
    .execute();
  try {
    await run();
  } finally {
    if (aside.length > 0) await owner.insertInto('admin.roles').values(aside).execute();
  }
}

describe('admin.grantRole et admin.revokeRole', () => {
  it('ne s’ouvrent qu’au super-administrateur à double authentification ; le refus est journalisé', async () => {
    const [player, target] = [await newUser(), await newUser('observer', root)];
    const others = await Promise.all(
      ADMIN_ROLES.filter((role) => role !== 'super_admin').map((role) => newUser(role, root)),
    );
    expect(others).toHaveLength(5);
    for (const [user, options] of [
      [player, {}],
      ...others.map((user) => [user, {}] as const),
      [root, { aal2: false }],
    ] as const) {
      for (const [command, input] of [
        ['admin.grantRole', { userId: user, role: 'super_admin' }],
        ['admin.grantRole', { userId: target, role: 'support' }],
        ['admin.revokeRole', { userId: target }],
      ] as const) {
        expect(await send(user, command, input, options)).toMatchObject({
          status: 403,
          body: { ok: false, error: { code: 'FORBIDDEN' } },
        });
      }
    }
    expect(await roleOf(player)).toBeUndefined();
    expect(await roleOf(target)).toEqual({ role: 'observer', granted_by: root });
    // Chaque refus est au journal : trois par compte, avec le rôle relu à cet instant.
    const refusals = await db
      .selectFrom('game.command_log')
      .select(['user_id', 'admin_role', (eb) => eb.fn.countAll<string>().as('n')])
      .where('user_id', 'in', [player, root])
      .where('error_code', '=', 'FORBIDDEN')
      .groupBy(['user_id', 'admin_role'])
      .execute();
    expect(refusals).toHaveLength(2);
    expect(refusals).toContainEqual({ user_id: player, admin_role: null, n: '3' });
    expect(refusals).toContainEqual({ user_id: root, admin_role: 'super_admin', n: '3' });
  });

  it('accorde, remplace puis retire un rôle : accès immédiat, événements, rejeu sans second effet', async () => {
    const actor = await newUser('super_admin', root);
    const target = await newUser();
    const me = (token: string) =>
      app.request('/api/admin/me', { headers: { authorization: `Bearer aal2:${token}` } });
    expect((await me(target)).status).toBe(403);

    expect(await send(actor, 'admin.grantRole', { userId: target, role: 'observer' })).toEqual({
      status: 200,
      replayed: 'false',
      body: { ok: true, data: { userId: target, role: 'observer', previousRole: null } },
    });
    expect(await roleOf(target)).toEqual({ role: 'observer', granted_by: actor });
    expect(await (await me(target)).json()).toEqual({ ok: true, data: { role: 'observer' } });

    const again = await send(actor, 'admin.grantRole', { userId: target, role: 'observer' });
    expect(again).toMatchObject({ status: 409, body: { error: { code: 'ROLE_UNCHANGED' } } });
    const replace = { userId: target, role: 'game_designer' };
    expect((await send(root, 'admin.grantRole', replace)).body).toEqual({
      ok: true,
      data: { ...replace, previousRole: 'observer' },
    });
    expect(await roleOf(target)).toEqual({ role: 'game_designer', granted_by: root });

    const key = randomUUID();
    const revoked = { ok: true, data: { userId: target, previousRole: 'game_designer' } };
    expect(await send(actor, 'admin.revokeRole', { userId: target }, { key })).toEqual({
      status: 200,
      replayed: 'false',
      body: revoked,
    });
    expect(await roleOf(target)).toBeUndefined();
    expect((await me(target)).status).toBe(403);
    // Même clé : la réponse enregistrée, pas un second retrait (qui répondrait ROLE_NOT_FOUND).
    expect(await send(actor, 'admin.revokeRole', { userId: target }, { key })).toEqual({
      status: 200,
      replayed: 'true',
      body: revoked,
    });
    expect(await send(actor, 'admin.revokeRole', { userId: target })).toMatchObject({
      status: 404,
      body: { error: { code: 'ROLE_NOT_FOUND' } },
    });

    const by = { command: 'admin.grantRole', admin_role: 'super_admin' };
    const granted = { userId: target, role: 'observer', previousRole: null, grantedBy: actor };
    const withdrawn = { userId: target, previousRole: 'game_designer', revokedBy: actor };
    expect(await eventsOf(actor)).toEqual([
      { ...by, type: 'AdminRoleGranted', payload: granted },
      { ...by, command: 'admin.revokeRole', type: 'AdminRoleRevoked', payload: withdrawn },
    ]);
  });

  it('refuse un compte inconnu, un rôle hors liste et le changement de son propre rôle', async () => {
    const actor = await newUser('super_admin', root);
    expect(
      await send(actor, 'admin.grantRole', { userId: randomUUID(), role: 'observer' }),
    ).toMatchObject({ status: 404, body: { error: { code: 'ACCOUNT_NOT_FOUND' } } });
    expect(await send(actor, 'admin.revokeRole', { userId: randomUUID() })).toMatchObject({
      status: 404,
      body: { error: { code: 'ACCOUNT_NOT_FOUND' } },
    });
    expect(await send(actor, 'admin.grantRole', { userId: root, role: 'god' })).toMatchObject({
      status: 400,
      body: { error: { code: 'VALIDATION_FAILED', fields: ['role'] } },
    });
    expect(await send(actor, 'admin.grantRole', { userId: actor, role: 'observer' })).toMatchObject(
      {
        status: 409,
        body: { error: { code: 'ROLE_SELF_GRANT' } },
      },
    );
    expect(await roleOf(actor)).toEqual({ role: 'super_admin', granted_by: root });
    expect(await eventsOf(actor)).toEqual([]);
  });

  it('garde toujours un super-administrateur, quel que soit le chemin', async () => {
    const [first, second] = [await newUser('super_admin'), await newUser('super_admin')];
    const observer = await newUser('observer', first);
    await alone([first, second, observer], async () => {
      // À deux, l'un peut se retirer lui-même ; resté seul, l'autre ne le peut plus.
      expect((await send(first, 'admin.revokeRole', { userId: first })).status).toBe(200);
      for (const [command, input] of [
        ['admin.revokeRole', { userId: second }],
        ['admin.grantRole', { userId: second, role: 'observer' }],
      ] as const) {
        const refused = await send(second, command, input);
        expect(refused.status).toBe(409);
        expect(refused.body).toMatchObject({
          error: { code: command === 'admin.revokeRole' ? 'LAST_SUPER_ADMIN' : 'ROLE_SELF_GRANT' },
        });
      }
      expect(await superAdmins()).toEqual([second]);
      // Le rôle de l'observateur, lui, se retire toujours.
      expect((await send(second, 'admin.revokeRole', { userId: observer })).status).toBe(200);
    });
  });

  it('deux retraits simultanés des deux derniers super-administrateurs : un seul passe', async () => {
    for (const crossed of [true, false, true, false, true, false]) {
      const [a, b] = [await newUser('super_admin'), await newUser('super_admin')];
      await alone([a, b], async () => {
        // Croisés : chacun retire l'autre. Sinon : chacun se retire lui-même.
        const outcomes = await Promise.all([
          send(a, 'admin.revokeRole', { userId: crossed ? b : a }),
          send(b, 'admin.revokeRole', { userId: crossed ? a : b }),
        ]);
        expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(
          crossed ? [200, 403] : [200, 409],
        );
        const refused = outcomes.find((outcome) => outcome.status !== 200);
        // Croisés, le perdant n'est plus super-administrateur quand son tour vient.
        expect(refused?.body).toMatchObject({
          error: { code: crossed ? 'FORBIDDEN' : 'LAST_SUPER_ADMIN' },
        });
        expect(await superAdmins()).toHaveLength(1);
      });
    }
  });
});

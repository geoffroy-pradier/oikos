import { randomUUID } from 'node:crypto';
import { ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { ADMIN_ROLES, CONFIG_EDITOR_ROLES, type AdminRole } from '@oikos/contracts';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { nextDailyClose } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS, createApp } from './app';
import { adminPublishConfig } from './commands/admin-config';
import { executeCommand } from './registry';
import { unlimited } from './rate-limit';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';

// Tests d'intégration des commandes d'administration de la configuration, contre Supabase local.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const app = createApp({
  db,
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

async function newUser(role?: AdminRole, grantedBy: string | null = null): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  if (role) {
    await owner
      .insertInto('admin.roles')
      .values({ user_id: id, role, granted_by: grantedBy })
      .execute();
  }
  return id;
}
let root: string;
let designer: string;
beforeAll(async () => {
  // Comme au démarrage de l'API : la configuration initiale existe et est active avant toute publication.
  // Sans cela, sur une base neuve, une version publiée ici ferait croire aux autres suites qu'elle l'est déjà.
  await ensureInitialConfig(db, INITIAL_CONFIG);
  root = await newUser('super_admin');
  designer = await newUser('game_designer', root);
});

/** Envoie une commande ; `aal2` ouvre une session à double authentification. */
const send = async (
  user: string,
  command: string,
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
    body: (await res.json()) as {
      data?: { versionId: string; number: number; activateAt: string };
      error?: { code: string; fields?: string[] };
    },
  };
};
const candidate = (grantOboles: number) => ({
  ...TEST_CONFIG.config,
  starting: { ...TEST_CONFIG.config.starting, grantOboles },
});
const versionsBy = (userId: string) =>
  db
    .selectFrom('config.versions')
    .select(['id', 'number', 'note', 'payload'])
    .where('created_by', '=', userId)
    .execute();
const logOf = (userId: string) =>
  db
    .selectFrom('game.command_log')
    .select(['command', 'status', 'error_code'])
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
const contextOf = (userId: string) =>
  db
    .selectFrom('game.command_log')
    .select(['status', 'aal', 'admin_role'])
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
const activeAt = async (instant: Date) =>
  (await sql<{ id: string }>`select config.active_version_at(${instant}) as id`.execute(db)).rows[0]
    ?.id;

describe('accès aux commandes d’administration', () => {
  it('refuse un compte sans rôle, un rôle insuffisant et une session sans second facteur ; le refus est journalisé', async () => {
    const player = await newUser();
    // Tous les rôles qui ne sont pas éditeurs de configuration, un compte chacun.
    const editors: readonly AdminRole[] = CONFIG_EDITOR_ROLES;
    const others = await Promise.all(
      ADMIN_ROLES.filter((role) => !editors.includes(role)).map((role) => newUser(role, root)),
    );
    expect(others).toHaveLength(4);
    const observer = others[0] ?? '';
    const input = { config: candidate(3100), note: 'tentative' };
    for (const [user, options] of [
      [player, {}],
      ...others.map((user) => [user, {}] as const),
      [designer, { aal2: false }],
      [root, { aal2: false }],
    ] as const) {
      expect(await send(user, 'admin.publishConfig', input, options)).toMatchObject({
        status: 403,
        body: { ok: false, error: { code: 'FORBIDDEN' } },
      });
      expect(
        await send(user, 'admin.scheduleConfig', { versionId: TEST_CONFIG.id }, options),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'FORBIDDEN' } },
      });
    }
    expect([...(await versionsBy(player)), ...(await versionsBy(observer))]).toEqual([]);
    expect(await logOf(player)).toEqual([
      { command: 'admin.publishConfig', status: 'rejected', error_code: 'FORBIDDEN' },
      { command: 'admin.scheduleConfig', status: 'rejected', error_code: 'FORBIDDEN' },
    ]);
  });

  it('le refus précède toute validation : même réponse quelle que soit l’entrée', async () => {
    const player = await newUser();
    for (const body of [{ config: 'texte' }, { inconnu: true }, null, { versionId: 'x' }]) {
      expect((await send(player, 'admin.publishConfig', body)).status).toBe(403);
      expect((await send(player, 'admin.scheduleConfig', body)).status).toBe(403);
    }
  });

  it('sans niveau d’assurance connu, la session est tenue pour simple', async () => {
    const outcome = await executeCommand(
      db,
      adminPublishConfig as never,
      { userId: root, idempotencyKey: randomUUID(), input: { config: candidate(3100) } },
      testConfig,
    );
    expect(outcome.response).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('toute commande du préfixe `admin.` déclare ses rôles, et aucune autre n’en déclare', () => {
    for (const command of COMMANDS) {
      expect([command.name, (command.admin?.length ?? 0) > 0]).toEqual([
        command.name,
        command.name.startsWith('admin.'),
      ]);
    }
    expect(COMMANDS.filter((command) => command.admin).length).toBeGreaterThanOrEqual(2);
  });

  it('un refus ne journalise que la taille et l’empreinte de l’entrée, et se rejoue avec la même clé', async () => {
    const player = await newUser();
    const key = randomUUID();
    const input = { config: { ...candidate(3100), padding: 'x'.repeat(50_000) } };
    const first = await send(player, 'admin.publishConfig', input, { key });
    expect(first.status).toBe(403);
    const logged = await db
      .selectFrom('game.command_log')
      .select(['input', sql<number>`pg_column_size(input)`.as('size')])
      .where('user_id', '=', player)
      .execute();
    expect(logged).toHaveLength(1);
    expect(logged[0]?.input).toEqual({
      redacted: true,
      bytes: Buffer.byteLength(JSON.stringify(input)),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
    });
    expect(logged[0]?.size).toBeLessThan(300);
    // Même clé, même entrée : la réponse enregistrée ; même clé, autre entrée : clé déjà utilisée.
    expect(await send(player, 'admin.publishConfig', input, { key })).toEqual(first);
    expect(
      (await send(player, 'admin.publishConfig', { config: candidate(1) }, { key })).body.error
        ?.code,
    ).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('un rôle retiré cesse d’agir à la commande suivante', async () => {
    const former = await newUser('game_designer', root);
    expect((await send(former, 'admin.publishConfig', { config: candidate(3200) })).status).toBe(
      200,
    );
    await owner.deleteFrom('admin.roles').where('user_id', '=', former).execute();
    expect((await send(former, 'admin.publishConfig', { config: candidate(3300) })).status).toBe(
      403,
    );
    expect(await versionsBy(former)).toHaveLength(1);
  });

  it('le journal garde la session et le rôle relu au moment de chaque commande', async () => {
    const [editor, watcher, player] = [
      await newUser('game_designer', root),
      await newUser('observer', root),
      await newUser(),
    ];
    const body = { config: candidate(4100), note: 'contexte' };
    await send(editor, 'admin.publishConfig', body);
    await send(editor, 'admin.publishConfig', body, { aal2: false });
    await send(watcher, 'admin.publishConfig', body);
    await send(player, 'admin.publishConfig', body);
    // Rôle retiré : la commande suivante est refusée, et le journal le montre sans rôle.
    await owner.deleteFrom('admin.roles').where('user_id', '=', editor).execute();
    await send(editor, 'admin.publishConfig', body);
    expect(await contextOf(editor)).toEqual([
      { status: 'ok', aal: 'aal2', admin_role: 'game_designer' },
      // Refusée faute de second facteur : le rôle du moment est tout de même noté.
      { status: 'rejected', aal: 'aal1', admin_role: 'game_designer' },
      { status: 'rejected', aal: 'aal2', admin_role: null },
    ]);
    expect(await contextOf(watcher)).toEqual([
      { status: 'rejected', aal: 'aal2', admin_role: 'observer' },
    ]);
    expect(await contextOf(player)).toEqual([
      { status: 'rejected', aal: 'aal2', admin_role: null },
    ]);
  });

  it('sans jeton, rien n’est exécuté', async () => {
    const res = await app.request('/api/commands/admin.publishConfig', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ config: candidate(3100) }),
    });
    expect(res.status).toBe(401);
  });
});

describe('admin.publishConfig', () => {
  it('crée une version immuable, attribuée, non active ; rejouer la clé ne crée rien de plus', async () => {
    const author = await newUser('game_designer', root);
    const key = randomUUID();
    const input = { config: candidate(3456), note: '  dotation revue  ' };
    const first = await send(author, 'admin.publishConfig', input, { key });
    expect(first.status).toBe(200);
    expect(await send(author, 'admin.publishConfig', input, { key })).toEqual(first);

    const versions = await versionsBy(author);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      id: first.body.data?.versionId,
      number: first.body.data?.number,
      note: 'dotation revue',
      payload: { starting: { grantOboles: 3456 } },
    });
    // Publier n'active pas : aucune activation ne vise cette version.
    const activations = await db
      .selectFrom('config.activations')
      .select('id')
      .where('version_id', '=', first.body.data?.versionId ?? '')
      .execute();
    expect(activations).toEqual([]);
    const events = await sql<{ payload: unknown }>`
      select payload from game.domain_events
      where type = 'ConfigVersionPublished' and payload->>'publishedBy' = ${author}`.execute(db);
    expect(events.rows).toEqual([
      { payload: { versionId: versions[0]?.id, number: versions[0]?.number, publishedBy: author } },
    ]);
    expect(await logOf(author)).toEqual([
      { command: 'admin.publishConfig', status: 'ok', error_code: null },
    ]);
  });

  it('refuse une configuration invalide, en nommant les champs, sans rien enregistrer', async () => {
    const author = await newUser('super_admin');
    const broken = { ...candidate(3000), market: { npcMaxPriceFactor: 0 } };
    const refused = await send(author, 'admin.publishConfig', { config: broken });
    expect(refused).toMatchObject({ status: 409, body: { error: { code: 'CONFIG_INVALID' } } });
    expect(refused.body.error?.fields?.join('\n')).toContain('market.npcMaxPriceFactor');
    // Une commande d'administration peut dépasser la taille d'une commande de jeu (16 Ko), dans sa propre limite.
    const large = { ...candidate(3000), padding: 'x'.repeat(100_000) };
    expect((await send(author, 'admin.publishConfig', { config: large })).status).toBe(409);
    const tooLarge = { ...candidate(3000), padding: 'x'.repeat(200_000) };
    expect((await send(author, 'admin.publishConfig', { config: tooLarge })).status).toBe(413);
    expect((await send(author, 'admin.publishConfig', { config: 'texte' })).status).toBe(400);
    expect(await versionsBy(author)).toEqual([]);
  });
});

describe('admin.scheduleConfig', () => {
  it('programme l’activation à la prochaine clôture quotidienne, pas avant', async () => {
    const author = await newUser('game_designer', root);
    // Même contenu que la configuration de test : l'activation ne change rien pour les autres suites.
    const published = await send(author, 'admin.publishConfig', { config: TEST_CONFIG.config });
    const versionId = published.body.data?.versionId ?? '';
    const before = new Date();
    const scheduled = await send(author, 'admin.scheduleConfig', { versionId });
    expect(scheduled.status).toBe(200);
    const activateAt = new Date(scheduled.body.data?.activateAt ?? 0);
    expect(activateAt.getTime()).toBe(nextDailyClose(before, TEST_CONFIG.config.clock).getTime());

    expect(await activeAt(activateAt)).toBe(versionId);
    expect(await activeAt(new Date(activateAt.getTime() - 1))).not.toBe(versionId);
    const activation = await db
      .selectFrom('config.activations')
      .select(['created_by', 'activate_at'])
      .where('version_id', '=', versionId)
      .executeTakeFirstOrThrow();
    expect(activation).toEqual({ created_by: author, activate_at: activateAt });
    const events = await sql<{ payload: unknown }>`
      select payload from game.domain_events
      where type = 'ConfigActivationScheduled' and payload->>'scheduledBy' = ${author}`.execute(db);
    expect(events.rows).toEqual([
      { payload: { versionId, activateAt: activateAt.toISOString(), scheduledBy: author } },
    ]);
  });

  it('retour arrière : reprogrammer une version antérieure la remet en vigueur à la clôture', async () => {
    const author = await newUser('super_admin');
    const publish = async () =>
      (await send(author, 'admin.publishConfig', { config: TEST_CONFIG.config })).body.data
        ?.versionId ?? '';
    const [older, newer] = [await publish(), await publish()];
    await send(author, 'admin.scheduleConfig', { versionId: newer });
    const back = await send(author, 'admin.scheduleConfig', { versionId: older });
    expect(await activeAt(new Date(back.body.data?.activateAt ?? 0))).toBe(older);
  });

  it('refuse de programmer une version dont le contenu ne respecte plus le schéma', async () => {
    // Version écrite directement en base, comme le ferait un schéma devenu plus strict après coup.
    const stale = await db
      .insertInto('config.versions')
      .values({ payload: JSON.stringify({ clock: {} }), note: 'périmée', created_by: root })
      .returning('id')
      .executeTakeFirstOrThrow();
    const refused = await send(designer, 'admin.scheduleConfig', { versionId: stale.id });
    expect(refused).toMatchObject({ status: 409, body: { error: { code: 'CONFIG_INVALID' } } });
    expect(refused.body.error?.fields?.length).toBeGreaterThan(0);
    const activations = await db
      .selectFrom('config.activations')
      .select('id')
      .where('version_id', '=', stale.id)
      .execute();
    expect(activations).toEqual([]);
  });

  it('refuse une version inconnue', async () => {
    expect(await send(designer, 'admin.scheduleConfig', { versionId: randomUUID() })).toMatchObject(
      {
        status: 404,
        body: { error: { code: 'CONFIG_VERSION_NOT_FOUND' } },
      },
    );
  });
});

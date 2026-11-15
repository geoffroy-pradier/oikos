import { randomUUID } from 'node:crypto';
import { ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { ADMIN_ROLES, CONFIG_EDITOR_ROLES, type AdminRole } from '@oikos/contracts';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { nextDailyClose } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS, createApp } from './app';
import { createTelemetry } from './telemetry';
import { adminPublishConfig } from './commands/admin-config';
import { executeCommand } from './registry';
import { unlimited } from './rate-limit';
import {
  farCloseClock,
  TEST_CONFIG,
  testConfig,
  testConfigWithClock,
  testVerifier,
} from './test-config';

// Tests d'intégration des commandes d'administration de la configuration, contre Supabase local.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const telemetry = createTelemetry(db);
const owner = createDb(DATABASE_URL);
// Clôture de test à plus d'une heure, quelle que soit l'heure réelle : dans la dernière minute avant
// l'échéance, la base refuserait les annulations et ces tests dépendraient de l'heure où ils tournent.
// Toute application de ce fichier programme avec cette horloge : une seule clôture à venir pour la suite.
const clock = farCloseClock(new Date());
const loadConfig = testConfigWithClock(clock);
const app = createApp({
  db,
  telemetry,
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig,
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
/**
 * Version que la clôture `due` trouve en vigueur : celle de l'instant qui la précède. Ce n'est pas
 * forcément celle de maintenant : la base est partagée et son journal en ajout seul, d'autres suites ou
 * une exécution précédente peuvent y avoir laissé une programmation qui échoit avant `due`.
 */
const inForceBefore = (due: Date) => activeAt(new Date(due.getTime() - 1));
/** Versions des programmations de l'instant donné qui ne sont pas annulées, la dernière en premier. */
const pendingAt = async (due: Date) =>
  (
    await db
      .selectFrom('config.activations as a')
      .leftJoin('config.activation_cancellations as c', 'c.activation_id', 'a.id')
      .select('a.version_id')
      .where('a.activate_at', '=', due)
      .where('c.activation_id', 'is', null)
      .orderBy('a.seq', 'desc')
      .execute()
  ).map((row) => row.version_id);

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

  it('refuse une version qui change la durée du tick, sans rien enregistrer (#123)', async () => {
    const author = await newUser('super_admin');
    for (const tickMinutes of [5, 20]) {
      const base = candidate(3000) as { clock: Record<string, unknown> };
      const refused = await send(author, 'admin.publishConfig', {
        config: { ...base, clock: { ...base.clock, tickMinutes } },
      });
      expect(refused).toMatchObject({
        status: 409,
        body: { error: { code: 'CONFIG_TICK_CHANGED', fields: ['clock.tickMinutes'] } },
      });
    }
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
    // Revue par une seconde personne : c'est un autre compte que l'auteur qui programme.
    const scheduled = await send(root, 'admin.scheduleConfig', { versionId });
    expect(scheduled.status).toBe(200);
    const activateAt = new Date(scheduled.body.data?.activateAt ?? 0);
    expect(activateAt.getTime()).toBe(nextDailyClose(before, clock).getTime());

    expect(await activeAt(activateAt)).toBe(versionId);
    expect(await activeAt(new Date(activateAt.getTime() - 1))).not.toBe(versionId);
    const activation = await db
      .selectFrom('config.activations')
      .select(['created_by', 'activate_at'])
      .where('version_id', '=', versionId)
      .executeTakeFirstOrThrow();
    expect(activation).toEqual({ created_by: root, activate_at: activateAt });
    const events = await sql<{ payload: unknown }>`
      select payload from game.domain_events
      where type = 'ConfigActivationScheduled' and payload->>'versionId' = ${versionId}`.execute(
      db,
    );
    expect(events.rows).toEqual([
      { payload: { versionId, activateAt: activateAt.toISOString(), scheduledBy: root } },
    ]);
  });

  it('retour arrière : reprogrammer une version antérieure la remet en vigueur à la clôture', async () => {
    const author = await newUser('super_admin');
    const publish = async () =>
      (await send(author, 'admin.publishConfig', { config: TEST_CONFIG.config })).body.data
        ?.versionId ?? '';
    const [older, newer] = [await publish(), await publish()];
    await send(designer, 'admin.scheduleConfig', { versionId: newer });
    const back = await send(designer, 'admin.scheduleConfig', { versionId: older });
    expect(await activeAt(new Date(back.body.data?.activateAt ?? 0))).toBe(older);
  });

  it('double validation : l’auteur ne programme pas sa version tant qu’un autre compte ne l’a pas fait', async () => {
    const author = await newUser('game_designer', root);
    const published = await send(author, 'admin.publishConfig', { config: TEST_CONFIG.config });
    const versionId = published.body.data?.versionId ?? '';
    const activations = () =>
      db
        .selectFrom('config.activations')
        .select('created_by')
        .where('version_id', '=', versionId)
        .orderBy('seq')
        .execute();

    const refused = await send(author, 'admin.scheduleConfig', { versionId });
    expect(refused).toEqual({
      status: 409,
      body: {
        ok: false,
        error: {
          code: 'CONFIG_REVIEW_REQUIRED',
          message: 'A version is scheduled by an account other than its author.',
        },
      },
    });
    expect(await activations()).toEqual([]);
    expect(await logOf(author)).toEqual([
      { command: 'admin.publishConfig', status: 'ok', error_code: null },
      { command: 'admin.scheduleConfig', status: 'rejected', error_code: 'CONFIG_REVIEW_REQUIRED' },
    ]);

    // Un autre compte la programme : elle est revue. Son auteur peut alors y revenir (retour arrière).
    expect((await send(designer, 'admin.scheduleConfig', { versionId })).status).toBe(200);
    expect((await send(author, 'admin.scheduleConfig', { versionId })).status).toBe(200);
    expect(await activations()).toEqual([{ created_by: designer }, { created_by: author }]);
  });

  it('une version sans auteur (configuration initiale) se programme sans revue', async () => {
    const initial = await db
      .insertInto('config.versions')
      .values({ payload: JSON.stringify(TEST_CONFIG.config), note: 'sans auteur' })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect((await send(designer, 'admin.scheduleConfig', { versionId: initial.id })).status).toBe(
      200,
    );
  });

  it('monde de test : le réglage de l’API lève la revue, sans valoir revue pour une API qui l’exige', async () => {
    const lenient = createApp({
      db,
      telemetry,
      verifyToken: testVerifier,
      rateLimiter: unlimited,
      // Même horloge que `app` : programmée à 04 h 00 (`testConfig`), cette version entrerait en vigueur
      // avant la clôture de test de 23 h 00 à 04 h 00, heure de Paris, sous les tests d'annulation.
      loadConfig,
      settings: { allowSelfReview: true },
    });
    const author = await newUser('game_designer', root);
    const published = await send(author, 'admin.publishConfig', { config: TEST_CONFIG.config });
    const versionId = published.body.data?.versionId ?? '';
    const selfScheduled = await lenient.request('/api/commands/admin.scheduleConfig', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer aal2:${author}`,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({ versionId }),
    });
    expect(selfScheduled.status).toBe(200);
    expect(((await selfScheduled.json()) as { data: { activateAt: string } }).data.activateAt).toBe(
      nextDailyClose(new Date(), clock).toISOString(),
    );
    // La programmation par l'auteur lui-même n'est pas une revue : l'API par défaut refuse toujours.
    expect((await send(author, 'admin.scheduleConfig', { versionId })).body.error?.code).toBe(
      'CONFIG_REVIEW_REQUIRED',
    );
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

  it('refuse de programmer une version qui change la durée du tick (#123)', async () => {
    // Version écrite directement en base, avant le refus à la publication.
    const other = {
      ...TEST_CONFIG.config,
      clock: { ...TEST_CONFIG.config.clock, tickMinutes: 20 },
    };
    const stale = await db
      .insertInto('config.versions')
      .values({ payload: JSON.stringify(other), note: 'tick de 20 min', created_by: root })
      .returning('id')
      .executeTakeFirstOrThrow();
    const refused = await send(designer, 'admin.scheduleConfig', { versionId: stale.id });
    expect(refused).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFIG_TICK_CHANGED', fields: ['clock.tickMinutes'] } },
    });
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

describe('admin.cancelActivation', () => {
  /** Publie une version sans effet sur les autres suites, programmée par un second compte. */
  async function scheduled(author: string, reviewer = root) {
    const published = await send(author, 'admin.publishConfig', { config: TEST_CONFIG.config });
    const versionId = published.body.data?.versionId ?? '';
    const { body } = await send(reviewer, 'admin.scheduleConfig', { versionId });
    const activateAt = body.data?.activateAt ?? '';
    return { versionId, activateAt, due: new Date(activateAt), ...(await latest(versionId)) };
  }
  const latest = async (versionId: string) => {
    const row = await db
      .selectFrom('config.activations')
      .select('id')
      .where('version_id', '=', versionId)
      .orderBy('seq', 'desc')
      .executeTakeFirstOrThrow();
    return { activationId: row.id };
  };
  const cancellations = (activationId: string) =>
    db
      .selectFrom('config.activation_cancellations')
      .select('cancelled_by')
      .where('activation_id', '=', activationId)
      .execute();

  it('annule toutes les programmations en attente pour la clôture : la version en vigueur le reste', async () => {
    const author = await newUser('game_designer', root);
    // Deux versions programmées pour la même clôture : la seconde l'emporterait.
    const earlier = await scheduled(designer);
    const { versionId, activateAt, due, activationId } = await scheduled(author);
    expect(earlier.activateAt).toBe(activateAt);
    expect(await activeAt(due)).toBe(versionId);
    // Ce que la clôture trouve en vigueur : ni l'une ni l'autre des deux versions programmées pour elle.
    const inForce = await inForceBefore(due);
    expect(inForce).toEqual(expect.any(String));
    expect([versionId, earlier.versionId]).not.toContain(inForce);

    // L'auteur peut annuler lui-même : retirer une programmation ne demande pas de seconde personne.
    const key = randomUUID();
    const cancelled = await send(author, 'admin.cancelActivation', { activationId }, { key });
    expect(cancelled.status).toBe(200);
    const data = cancelled.body.data as unknown as {
      cancelled: { activationId: string; versionId: string }[];
    };
    expect(cancelled.body.data).toMatchObject({ activationId, versionId, activateAt });
    // Celle désignée en premier ; la programmation antérieure de la même clôture ne revient pas en jeu.
    expect(data.cancelled[0]).toEqual({ activationId, versionId });
    expect(data.cancelled).toContainEqual({
      activationId: earlier.activationId,
      versionId: earlier.versionId,
    });
    // Plus rien n'attend cette clôture, pas même les programmations laissées par les tests précédents :
    // elle ne change rien, la version en vigueur à son arrivée le reste. Rien d'autre n'a bougé.
    expect(await pendingAt(due)).toEqual([]);
    expect(await activeAt(due)).toBe(inForce);
    expect(await inForceBefore(due)).toBe(inForce);
    expect(await cancellations(activationId)).toEqual([{ cancelled_by: author }]);
    expect(await cancellations(earlier.activationId)).toEqual([{ cancelled_by: author }]);
    const events = await sql<{ activation: string }>`
      select payload->>'activationId' as activation from game.domain_events
      where type = 'ConfigActivationCancelled' and payload->>'cancelledBy' = ${author}`.execute(db);
    // Un événement par programmation annulée (inscrits ensemble : leur ordre n'est pas significatif).
    expect(events.rows.map((row) => row.activation).sort()).toEqual(
      data.cancelled.map((row) => row.activationId).sort(),
    );
    // Même clé : la réponse enregistrée. Nouvelle demande, pour l'une ou l'autre : déjà annulée.
    expect(await send(author, 'admin.cancelActivation', { activationId }, { key })).toEqual(
      cancelled,
    );
    for (const id of [activationId, earlier.activationId]) {
      expect(await send(designer, 'admin.cancelActivation', { activationId: id })).toMatchObject({
        status: 409,
        body: { error: { code: 'CONFIG_ACTIVATION_CANCELLED' } },
      });
    }

    const listing = await app.request('/api/admin/config/versions', {
      headers: { authorization: `Bearer aal2:${root}` },
    });
    const listed = (
      (await listing.json()) as { data: { activations: { id: string; cancelledAt: string }[] } }
    ).data.activations.find((activation) => activation.id === activationId);
    expect(listed).toMatchObject({ versionId, activateAt, createdBy: root, cancelledBy: author });
    expect(Date.parse(listed?.cancelledAt ?? '')).toBeLessThanOrEqual(Date.now());

    // Reprogrammée par son auteur (une programmation annulée vaut toujours revue) : elle l'emporte.
    expect((await send(author, 'admin.scheduleConfig', { versionId })).status).toBe(200);
    expect(await activeAt(due)).toBe(versionId);
    expect(await cancellations((await latest(versionId)).activationId)).toEqual([]);
  });

  it('refuse une programmation inconnue, une activation déjà en vigueur, un rôle de lecture', async () => {
    expect(
      await send(designer, 'admin.cancelActivation', { activationId: randomUUID() }),
    ).toMatchObject({ status: 404, body: { error: { code: 'CONFIG_ACTIVATION_NOT_FOUND' } } });
    const inForce = await db
      .selectFrom('config.activations')
      .select('id')
      .where('activate_at', '<=', new Date())
      .orderBy('seq')
      .executeTakeFirstOrThrow();
    expect(
      await send(designer, 'admin.cancelActivation', { activationId: inForce.id }),
    ).toMatchObject({ status: 409, body: { error: { code: 'CONFIG_ACTIVATION_PAST' } } });
    expect(await cancellations(inForce.id)).toEqual([]);

    const { activationId } = await scheduled(designer);
    const observer = await newUser('observer', root);
    expect((await send(observer, 'admin.cancelActivation', { activationId })).status).toBe(403);
    expect(
      (await send(designer, 'admin.cancelActivation', { activationId }, { aal2: false })).status,
    ).toBe(403);
    expect(await cancellations(activationId)).toEqual([]);
  });

  it('concurrence : deux annulations de la même programmation, une seule passe', async () => {
    for (let round = 0; round < 4; round++) {
      const { activationId } = await scheduled(designer);
      const outcomes = await Promise.all(
        [root, designer].map((user) => send(user, 'admin.cancelActivation', { activationId })),
      );
      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([200, 409]);
      expect(outcomes.find((outcome) => outcome.status === 409)?.body.error?.code).toBe(
        'CONFIG_ACTIVATION_CANCELLED',
      );
      expect(await cancellations(activationId)).toHaveLength(1);
    }
  });

  it('concurrence : annuler pendant qu’une autre version est programmée pour la même clôture', async () => {
    for (let round = 0; round < 4; round++) {
      const first = await scheduled(designer);
      const other = await send(designer, 'admin.publishConfig', { config: TEST_CONFIG.config });
      const otherId = other.body.data?.versionId ?? '';
      // En même temps : la première est annulée, une autre version est programmée, et la première
      // (déjà revue) est reprogrammée par son auteur. Aucune ne tombe en panne.
      const [cancel, schedule, again] = await Promise.all([
        send(root, 'admin.cancelActivation', { activationId: first.activationId }),
        send(root, 'admin.scheduleConfig', { versionId: otherId }),
        send(designer, 'admin.scheduleConfig', { versionId: first.versionId }),
      ]);
      expect([cancel.status, schedule.status, again.status]).toEqual([200, 200, 200]);
      expect(await cancellations(first.activationId)).toHaveLength(1);
      // Selon l'ordre d'arrivée, les deux programmations simultanées ont été annulées avec elle ou
      // restent en attente : dans les deux cas la clôture désigne la dernière qui reste, ou rien de neuf.
      const pending = await pendingAt(first.due);
      expect(pending.length).toBeLessThanOrEqual(2);
      expect(await activeAt(first.due)).toBe(pending[0] ?? (await inForceBefore(first.due)));
    }
  });
});

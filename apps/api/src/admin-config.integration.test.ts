import { randomUUID } from 'node:crypto';
import { ConfigError, ensureInitialConfig, INITIAL_CONFIG, validateConfig } from '@oikos/config';
import {
  ADMIN_ROLES,
  alreadyRetiredUsageSchema,
  CONFIG_EDITOR_ROLES,
  retiredUsageSchema,
  type AdminRole,
  type RetiredUsage,
} from '@oikos/contracts';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { nextDailyClose } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS, createApp } from './app';
import { createTelemetry } from './telemetry';
import { adminPublishConfig, adminScheduleConfig } from './commands/admin-config';
import { defineCommand, executeCommand, type ConfigSource } from './registry';
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
/** Versions programmées par ce fichier : leurs activations encore à venir sont annulées à la fin. */
const scheduledVersions = new Set<string>();
afterAll(async () => {
  // Ces versions ont l'horloge de test : activées, elles feraient clore la base locale à une autre heure,
  // et le changement d'horloge étant refusé, rien ne permettrait d'y revenir (#123).
  // Une annulation retire toutes les programmations en attente pour la même clôture.
  const pending = () =>
    db
      .selectFrom('config.activations as a')
      .leftJoin('config.activation_cancellations as c', 'c.activation_id', 'a.id')
      .select('a.id')
      .where('a.version_id', 'in', [...scheduledVersions, randomUUID()])
      .where('a.activate_at', '>', new Date())
      .where('c.activation_id', 'is', null)
      .executeTakeFirst();
  for (let next = await pending(); next; next = await pending())
    expect((await send(root, 'admin.cancelActivation', { activationId: next.id })).status).toBe(
      200,
    );
  await Promise.all([db.destroy(), owner.destroy()]);
});

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
/**
 * Rend à un puits les stocks de biens que la configuration de test ne connaît pas, laissés par une autre
 * suite de la même base (le moteur y garde du murex après `voyage-arrivals`, #484). Toute version
 * programmée ici retirerait ces biens et serait refusée (`CONFIG_GOOD_IN_USE`) : ces tests ne doivent pas
 * dépendre de l'ordre des paquets. Par le journal des stocks, comme `clearRelic`, jamais en effaçant.
 */
async function drainForeignStock(): Promise<void> {
  const kept = TEST_CONFIG.config.goods.map((good) => good.id);
  const foreign = await db
    .selectFrom('game.inventories')
    .select(['id', 'world_id', 'good_id', 'quantity'])
    .where('quantity', '>', '0')
    .where('good_id', '<>', sql<string>`all(${kept}::text[])`)
    .execute();
  for (const stock of foreign)
    await db
      .insertInto('game.stock_ledger')
      .values({
        world_id: stock.world_id,
        good_id: stock.good_id,
        quantity: Number(stock.quantity),
        kind: 'test.foreign_stock',
        from_inventory_id: stock.id,
        to_system: 'consumption',
      })
      .execute();
}
let root: string;
let designer: string;
beforeAll(async () => {
  await drainForeignStock();
  // Comme au démarrage de l'API : la configuration initiale existe et est active avant toute publication.
  // Sans cela, sur une base neuve, une version publiée ici ferait croire aux autres suites qu'elle l'est déjà.
  await ensureInitialConfig(db, INITIAL_CONFIG);
  root = await newUser('super_admin');
  designer = await newUser('game_designer', root);
});

/**
 * Envoie une commande ; `aal2` ouvre une session à double authentification. Une programmation est
 * confirmée (#200) sauf si le corps dit le contraire : les versions de ce fichier retirent les recettes
 * et les classes que d'autres suites laissent en usage dans la base partagée.
 */
const send = async (
  user: string,
  command: string,
  body: unknown,
  { aal2 = true, key = randomUUID() as string, via = app } = {},
) => {
  const confirmed =
    command === 'admin.scheduleConfig' && typeof body === 'object' && body !== null
      ? { confirmRetiredInUse: true, ...body }
      : body;
  const res = await via.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${aal2 ? 'aal2:' : ''}${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(confirmed),
  });
  const versionId = (body as { versionId?: unknown } | null)?.versionId;
  if (command === 'admin.scheduleConfig' && res.status === 200 && typeof versionId === 'string')
    scheduledVersions.add(versionId);
  return {
    status: res.status,
    body: (await res.json()) as {
      data?: { versionId: string; number: number; activateAt: string };
      error?: { code: string; fields?: string[] };
    },
  };
};
// Les versions publiées ici gardent l'horloge chargée par ce fichier : elle ne change pas (#123).
const SAME_CLOCK = { ...TEST_CONFIG.config, clock };
const candidate = (grantOboles: number) => ({
  ...SAME_CLOCK,
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

  it('refuse une version qui change l’horloge (durée du tick, heure ou fuseau de clôture), sans rien enregistrer (#123)', async () => {
    const author = await newUser('super_admin');
    const base = candidate(3000) as unknown as { clock: Record<string, unknown> };
    for (const [change, fields] of [
      [{ tickMinutes: 5 }, ['clock.tickMinutes']],
      [{ tickMinutes: 20 }, ['clock.tickMinutes']],
      [{ dailyCloseHour: 6 }, ['clock.dailyCloseHour']],
      [{ timezone: 'UTC', dailyCloseHour: 2 }, ['clock.dailyCloseHour', 'clock.timezone']],
    ] as const) {
      const refused = await send(author, 'admin.publishConfig', {
        config: { ...base, clock: { ...base.clock, ...change } },
      });
      expect(refused).toMatchObject({
        status: 409,
        body: { error: { code: 'CONFIG_CLOCK_CHANGED', fields } },
      });
    }
    // La saison, elle, reste réglable.
    const seasons = await send(author, 'admin.publishConfig', {
      config: { ...base, clock: { ...base.clock, seasonDays: 14 } },
    });
    expect(seasons.status).toBe(200);
    expect(await versionsBy(author)).toHaveLength(1);
  });

  it('un fuseau inconnu de la base, différent de celui en vigueur, est refusé comme changement d’horloge', async () => {
    // Le changement d'horloge est contrôlé avant le fuseau : `US/Pacific-New`, valide pour `Intl` mais
    // retiré de la base des fuseaux, est un fuseau de clôture changé.
    const author = await newUser('super_admin');
    const config = { ...candidate(3000), clock: { ...clock, timezone: 'US/Pacific-New' } };
    expect(await send(author, 'admin.publishConfig', { config })).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFIG_CLOCK_CHANGED', fields: ['clock.timezone'] } },
    });
    expect(await versionsBy(author)).toEqual([]);
    expect(await logOf(author)).toEqual([
      { command: 'admin.publishConfig', status: 'rejected', error_code: 'CONFIG_CLOCK_CHANGED' },
    ]);
  });
});

describe('admin.scheduleConfig', () => {
  it('programme l’activation à la prochaine clôture quotidienne, pas avant', async () => {
    const author = await newUser('game_designer', root);
    // Même contenu que la configuration de test, et annulée à la fin du fichier : rien ne change ailleurs.
    const published = await send(author, 'admin.publishConfig', { config: SAME_CLOCK });
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
    // `confirmedRetired` dépend de ce que d'autres suites laissent en usage : vérifié par les tests de #200.
    expect(events.rows).toEqual([
      {
        payload: {
          versionId,
          activateAt: activateAt.toISOString(),
          scheduledBy: root,
          confirmedRetired: expect.any(Array),
        },
      },
    ]);
  });

  it('retour arrière : reprogrammer une version antérieure la remet en vigueur à la clôture', async () => {
    const author = await newUser('super_admin');
    const publish = async () =>
      (await send(author, 'admin.publishConfig', { config: SAME_CLOCK })).body.data?.versionId ??
      '';
    const [older, newer] = [await publish(), await publish()];
    await send(designer, 'admin.scheduleConfig', { versionId: newer });
    const back = await send(designer, 'admin.scheduleConfig', { versionId: older });
    expect(await activeAt(new Date(back.body.data?.activateAt ?? 0))).toBe(older);
  });

  it('double validation : l’auteur ne programme pas sa version tant qu’un autre compte ne l’a pas fait', async () => {
    const author = await newUser('game_designer', root);
    const published = await send(author, 'admin.publishConfig', { config: SAME_CLOCK });
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
      .values({ payload: JSON.stringify(SAME_CLOCK), note: 'sans auteur' })
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
    const published = await send(author, 'admin.publishConfig', { config: SAME_CLOCK });
    const versionId = published.body.data?.versionId ?? '';
    const selfScheduled = await lenient.request('/api/commands/admin.scheduleConfig', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer aal2:${author}`,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({ versionId, confirmRetiredInUse: true }),
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
      ...SAME_CLOCK,
      clock: { ...clock, tickMinutes: 20 },
    };
    const stale = await db
      .insertInto('config.versions')
      .values({ payload: JSON.stringify(other), note: 'tick de 20 min', created_by: root })
      .returning('id')
      .executeTakeFirstOrThrow();
    const refused = await send(designer, 'admin.scheduleConfig', { versionId: stale.id });
    expect(refused).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFIG_CLOCK_CHANGED', fields: ['clock.tickMinutes'] } },
    });
    const activations = await db
      .selectFrom('config.activations')
      .select('id')
      .where('version_id', '=', stale.id)
      .execute();
    expect(activations).toEqual([]);
  });

  it('refuse de programmer une version au fuseau inconnu de la base et différent : changement d’horloge', async () => {
    // Version publiée avant ces contrôles : son fuseau, retiré de la base, n'est pas celui en vigueur.
    const other = { ...SAME_CLOCK, clock: { ...clock, timezone: 'Canada/East-Saskatchewan' } };
    const stale = await db
      .insertInto('config.versions')
      .values({ payload: JSON.stringify(other), note: 'fuseau retiré', created_by: root })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect(await send(designer, 'admin.scheduleConfig', { versionId: stale.id })).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFIG_CLOCK_CHANGED', fields: ['clock.timezone'] } },
    });
    const activations = await db
      .selectFrom('config.activations')
      .select('id')
      .where('version_id', '=', stale.id)
      .execute();
    expect(activations).toEqual([]);
  });

  it('le fuseau en vigueur n’est jamais refusé comme inconnu de la base : la version se publie et se programme', async () => {
    // Monde dont le fuseau en vigueur est sorti de la base des fuseaux (mise à jour de tzdata) : l'horloge
    // ne changeant pas, le refuser comme inconnu à la publication empêcherait toute nouvelle version. La
    // programmation ne contrôle pas le fuseau : elle refuse déjà tout changement d'horloge.
    const stranded = farCloseClock(new Date(), {
      ...TEST_CONFIG.config.clock,
      timezone: 'US/Pacific-New',
    });
    const via = createApp({
      db,
      telemetry,
      verifyToken: testVerifier,
      rateLimiter: unlimited,
      loadConfig: testConfigWithClock(stranded),
    });
    const author = await newUser('game_designer', root);
    const config = { ...TEST_CONFIG.config, clock: stranded };
    const published = await send(author, 'admin.publishConfig', { config }, { via });
    expect(published.status).toBe(200);
    const versionId = published.body.data?.versionId ?? '';
    expect(await send(designer, 'admin.scheduleConfig', { versionId }, { via })).toMatchObject({
      status: 200,
      body: { data: { activateAt: nextDailyClose(new Date(), stranded).toISOString() } },
    });
    // Retirée aussitôt : la base locale n'est pas à cette horloge.
    const activation = await db
      .selectFrom('config.activations')
      .select('id')
      .where('version_id', '=', versionId)
      .executeTakeFirstOrThrow();
    const cancelled = await send(root, 'admin.cancelActivation', { activationId: activation.id });
    expect(cancelled.status).toBe(200);
  });

  it('refuse une version inconnue', async () => {
    expect(await send(designer, 'admin.scheduleConfig', { versionId: randomUUID() })).toMatchObject(
      {
        status: 404,
        body: { error: { code: 'CONFIG_VERSION_NOT_FOUND' } },
      },
    );
  });

  it('à moins d’une minute de l’échéance, la base refuse : CONFIG_ACTIVATION_TOO_LATE, journalisé sous la clé', async () => {
    // La prochaine clôture réelle est rarement si proche : la commande est jouée avec une échéance à
    // trente secondes, posée dans sa transaction comme le ferait une clôture imminente.
    const published = await send(designer, 'admin.publishConfig', { config: SAME_CLOCK });
    const versionId = published.body.data?.versionId ?? '';
    const imminent = defineCommand({
      ...adminScheduleConfig,
      async handler({ trx }) {
        await sql`insert into config.activations (version_id, activate_at)
          values (${versionId}, clock_timestamp() + interval '30 seconds')`.execute(trx);
        return { ok: true, data: { versionId, activateAt: new Date().toISOString() } };
      },
    });
    const key = randomUUID();
    const outcome = await executeCommand(
      db,
      imminent,
      { userId: root, aal: 'aal2', idempotencyKey: key, input: { versionId } },
      loadConfig,
    );
    expect(outcome).toMatchObject({
      replayed: false,
      response: { ok: false, error: { code: 'CONFIG_ACTIVATION_TOO_LATE' } },
    });
    const logged = await db
      .selectFrom('game.command_log')
      .select(['status', 'error_code'])
      .where('user_id', '=', root)
      .where('idempotency_key', '=', key)
      .execute();
    expect(logged).toEqual([{ status: 'rejected', error_code: 'CONFIG_ACTIVATION_TOO_LATE' }]);
    const activations = await db
      .selectFrom('config.activations')
      .select('id')
      .where('version_id', '=', versionId)
      .execute();
    expect(activations).toEqual([]);
  });
});

describe('admin.cancelActivation', () => {
  /** Publie une version sans effet sur les autres suites, programmée par un second compte. */
  async function scheduled(author: string, reviewer = root) {
    const published = await send(author, 'admin.publishConfig', { config: SAME_CLOCK });
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
      const other = await send(designer, 'admin.publishConfig', { config: SAME_CLOCK });
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

describe('bien retiré encore détenu ou porté par un ordre ouvert (#191)', () => {
  // Bien propre à cette exécution : aucun autre monde ne le porte. Il est rendu à zéro après chaque
  // test, sinon plus aucune version sans lui ne se programmerait dans la base partagée.
  // Le contrôle porte sur tous les mondes : une exécution tuée avant `afterAll(clearRelic)` laisse un
  // bien `relic_*` détenu, et toute programmation de ce fichier (versions sans ce bien) est ensuite
  // refusée (`CONFIG_GOOD_IN_USE`). Pour remettre la base en état : `pnpm db:reset`, ou, sans
  // effacer la base, annuler les ordres ouverts `relic_*` par `market.cancelOrder` et rendre leurs
  // stocks à un puits par le journal des stocks (`to_system = 'consumption'`), comme `clearRelic`.
  const RELIC = `relic_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const relic = { id: RELIC, tier: 'finished' as const, referencePriceOboles: 40, elasticity: 1 };
  const WITH_RELIC = { ...SAME_CLOCK, goods: [...SAME_CLOCK.goods, relic] };
  const GRANT = SAME_CLOCK.starting.grantOboles;
  // Le marché tant que le bien est en vigueur ; `app` est celui d'après son retrait.
  const market = createApp({
    db,
    telemetry,
    verifyToken: testVerifier,
    rateLimiter: unlimited,
    loadConfig: async () => ({ ...TEST_CONFIG, config: WITH_RELIC }),
  });
  const WORLD = randomUUID();
  const CITY = randomUUID();
  const players: { user: string; houseId: string }[] = [];
  beforeAll(async () => {
    await sql`insert into game.worlds (id, slug, name) values (${WORLD}, ${`r-${WORLD.slice(0, 12)}`}, 'Bien retiré')`.execute(
      owner,
    );
    await sql`insert into game.cities (id, world_id, slug, name) values (${CITY}, ${WORLD}, ${`c-${CITY.slice(0, 8)}`}, 'Agora')`.execute(
      owner,
    );
  });
  const moveStock = (
    quantity: number,
    ends:
      | { from_inventory_id: string; to_system: string }
      | { from_system: string; to_inventory_id: string },
  ) =>
    db
      .insertInto('game.stock_ledger')
      .values({ world_id: WORLD, good_id: RELIC, quantity, kind: 'test.relic', ...ends })
      .execute();
  /** Ce que le bien laisse : ordres ouverts annulés par leur maison, stock rendu à un puits. */
  const clearRelic = async () => {
    for (const player of players) {
      const open = await db
        .selectFrom('game.orders')
        .select('id')
        .where('house_id', '=', player.houseId)
        .where('good_id', '=', RELIC)
        .where('status', '=', 'open')
        .execute();
      for (const { id } of open)
        expect(
          (await send(player.user, 'market.cancelOrder', { orderId: id }, { aal2: false })).status,
        ).toBe(200);
    }
    const held = await db
      .selectFrom('game.inventories')
      .select(['id', 'quantity'])
      .where('world_id', '=', WORLD)
      .where('good_id', '=', RELIC)
      .where('quantity', '>', '0')
      .execute();
    for (const stock of held)
      await moveStock(Number(stock.quantity), {
        from_inventory_id: stock.id,
        to_system: 'consumption',
      });
  };
  afterAll(clearRelic);

  const player = async (stock = 0) => {
    const user = await newUser();
    const founded = await send(
      user,
      'house.create',
      {
        cityId: CITY,
        name: `Maison ${randomUUID()
          .replace(/[^a-f]/g, '')
          .slice(0, 8)}`,
        blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
      },
      { aal2: false, via: market },
    );
    const houseId = (founded.body.data as unknown as { houseId: string }).houseId;
    players.push({ user, houseId });
    if (stock > 0) {
      const inventory = await db
        .insertInto('game.inventories')
        .values({ world_id: WORLD, house_id: houseId, city_id: CITY, good_id: RELIC })
        .returning('id')
        .executeTakeFirstOrThrow();
      await moveStock(stock, { from_system: 'production', to_inventory_id: inventory.id });
    }
    return { user, houseId };
  };
  const order = (
    user: string,
    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    via = market,
  ) =>
    send(
      user,
      'market.placeOrder',
      { cityId: CITY, goodId: RELIC, side, price, quantity },
      { aal2: false, via },
    );
  const publish = async (config: unknown) =>
    (await send(designer, 'admin.publishConfig', { config })).body.data?.versionId ?? '';
  /** Ce qu'Olympe montre de la version avant sa programmation. */
  const retiredInUse = async (versionId: string) => {
    const res = await app.request('/api/admin/config/versions', {
      headers: { authorization: `Bearer aal2:${root}` },
    });
    const listing = (await res.json()) as {
      data: { versions: { id: string; retiredInUse: unknown }[] };
    };
    const version = listing.data.versions.find((entry) => entry.id === versionId);
    return retiredUsageSchema
      .parse(version?.retiredInUse)
      .goods.filter((good) => good.goodId === RELIC);
  };
  const activations = (versionId: string) =>
    db.selectFrom('config.activations').select('id').where('version_id', '=', versionId).execute();
  const balances = async (houseId: string) =>
    Object.fromEntries(
      (
        await db
          .selectFrom('game.accounts')
          .select(['kind', 'balance'])
          .where('house_id', '=', houseId)
          .execute()
      ).map((account) => [account.kind, Number(account.balance)]),
    );

  it('refuse de programmer une version sans un bien détenu en stock, et Olympe le dit avant', async () => {
    const [without, withRelic] = [await publish(SAME_CLOCK), await publish(WITH_RELIC)];
    await player(7);
    expect(await retiredInUse(without)).toEqual([
      { goodId: RELIC, houses: 1, quantity: 7, openOrders: 0, escrowOboles: 0 },
    ]);
    expect(await retiredInUse(withRelic)).toEqual([]);
    const refused = await send(root, 'admin.scheduleConfig', { versionId: without });
    expect(refused).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFIG_GOOD_IN_USE', fields: [`goods.${RELIC}`] } },
    });
    expect(await activations(without)).toEqual([]);
    // La version qui garde le bien se programme ; le stock rendu, celle qui le retire aussi.
    expect((await send(root, 'admin.scheduleConfig', { versionId: withRelic })).status).toBe(200);
    await clearRelic();
    expect(await retiredInUse(without)).toEqual([]);
    expect((await send(root, 'admin.scheduleConfig', { versionId: without })).status).toBe(200);
  });

  it('refuse une version sans un bien porté par un seul ordre d’achat ouvert, sans aucun stock ; acceptée après annulation', async () => {
    const without = await publish(SAME_CLOCK);
    const buyer = await player();
    const placed = await order(buyer.user, 'buy', 8, 5);
    expect(placed.status).toBe(200);
    // Seul le séquestre porte le bien : aucune maison n'en détient une unité.
    expect(await retiredInUse(without)).toEqual([
      { goodId: RELIC, houses: 1, quantity: 0, openOrders: 1, escrowOboles: 40 },
    ]);
    expect(await send(root, 'admin.scheduleConfig', { versionId: without })).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFIG_GOOD_IN_USE', fields: [`goods.${RELIC}`] } },
    });
    expect(await activations(without)).toEqual([]);
    const orderId = (placed.body.data as unknown as { orderId: string }).orderId;
    const cancel = { aal2: false, via: market };
    expect((await send(buyer.user, 'market.cancelOrder', { orderId }, cancel)).status).toBe(200);
    expect(await retiredInUse(without)).toEqual([]);
    expect((await send(root, 'admin.scheduleConfig', { versionId: without })).status).toBe(200);
  });

  it('refuse une version sans un bien porté par un ordre ouvert ; retiré, l’ordre reste annulable et son séquestre rendu', async () => {
    const without = await publish(SAME_CLOCK);
    const [seller, buyer] = [await player(4), await player()];
    // Ni l'un ni l'autre ne se croisent : tous deux attendent dans le carnet.
    expect((await order(seller.user, 'sell', 50, 3)).status).toBe(200);
    expect((await order(buyer.user, 'buy', 9, 5)).status).toBe(200);
    expect(await balances(buyer.houseId)).toEqual({ house: GRANT - 45, escrow: 45 });
    expect(await retiredInUse(without)).toEqual([
      { goodId: RELIC, houses: 2, quantity: 4, openOrders: 2, escrowOboles: 45 },
    ]);
    expect(await send(root, 'admin.scheduleConfig', { versionId: without })).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFIG_GOOD_IN_USE', fields: [`goods.${RELIC}`] } },
    });

    // Repli, si le bien est retiré quand même (acquis entre la programmation et la clôture) : aucune
    // erreur interne. Un nouvel ordre est refusé, les ordres ouverts s'annulent, le séquestre est rendu.
    expect(await order(buyer.user, 'buy', 9, 1, app)).toMatchObject({
      status: 404,
      body: { error: { code: 'GOOD_NOT_FOUND' } },
    });
    for (const { user, houseId } of [buyer, seller]) {
      const [open] = await db
        .selectFrom('game.orders')
        .select(['id', 'remaining'])
        .where('house_id', '=', houseId)
        .where('status', '=', 'open')
        .execute();
      const cancelled = await send(
        user,
        'market.cancelOrder',
        { orderId: open?.id },
        { aal2: false },
      );
      expect(cancelled).toMatchObject({
        status: 200,
        body: { data: { status: 'cancelled', released: Number(open?.remaining) } },
      });
    }
    expect(await balances(buyer.houseId)).toEqual({ house: GRANT, escrow: 0 });
    const stock = await db
      .selectFrom('game.inventories')
      .select(['quantity', 'reserved'])
      .where('house_id', '=', seller.houseId)
      .where('good_id', '=', RELIC)
      .executeTakeFirstOrThrow();
    expect(stock).toEqual({ quantity: '4', reserved: '0' });
    // Le stock libéré reste détenu : la version qui retire le bien reste refusée tant qu'il l'est.
    expect(await retiredInUse(without)).toEqual([
      { goodId: RELIC, houses: 1, quantity: 4, openOrders: 0, escrowOboles: 0 },
    ]);
    await clearRelic();
    expect((await send(root, 'admin.scheduleConfig', { versionId: without })).status).toBe(200);
  });
});

describe('recette ou classe retirée encore en usage (#200)', () => {
  // Recette, classe et bien propres à cette exécution, ôtés après les tests : le contrôle porte sur
  // tous les mondes, et la base partagée ne doit rien en garder.
  const tag = randomUUID().replace(/-/g, '').slice(0, 10);
  const [RECIPE, CLASS, GOOD] = [`rite_${tag}`, `cls_${tag}`, `token_${tag}`];
  const [recipe] = SAME_CLOCK.recipes;
  const [npcClass] = SAME_CLOCK.npcClasses;
  const WITH_RECIPE = {
    ...SAME_CLOCK,
    recipes: [...SAME_CLOCK.recipes, { ...recipe, id: RECIPE }],
  };
  const WITH_BOTH = {
    ...WITH_RECIPE,
    npcClasses: [...SAME_CLOCK.npcClasses, { ...npcClass, id: CLASS }],
    cities: SAME_CLOCK.cities.map((city) => ({
      ...city,
      population: { ...city.population, [CLASS]: 10 },
    })),
  };
  const WORLD = randomUUID();
  const CITY = randomUUID();
  const OTHER_CITY = randomUUID();
  /** Stock du bien, entré ou rendu à un puits par le journal des stocks, qui ne s'efface pas. */
  const moveToken = (inventoryId: string, quantity: number, back = false) =>
    db
      .insertInto('game.stock_ledger')
      .values({
        world_id: WORLD,
        good_id: GOOD,
        quantity,
        kind: 'test.token',
        ...(back
          ? { from_inventory_id: inventoryId, to_system: 'consumption' }
          : { from_system: 'production', to_inventory_id: inventoryId }),
      })
      .execute();
  const house = async () => {
    const created = await send(
      await newUser(),
      'house.create',
      {
        cityId: CITY,
        name: `Maison ${randomUUID()
          .replace(/[^a-f]/g, '')
          .slice(0, 8)}`,
        blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
      },
      { aal2: false },
    );
    return (created.body.data as unknown as { houseId: string }).houseId;
  };
  const site = (houseId: string) =>
    sql`insert into game.sites (world_id, house_id, city_id, recipe_id) values (${WORLD}, ${houseId}, ${CITY}, ${RECIPE})`.execute(
      owner,
    );
  // Deux maisons, trois sites sur la recette ; la classe a un état dans les deux cités, l'un vide.
  beforeAll(async () => {
    await sql`insert into game.worlds (id, slug, name) values (${WORLD}, ${`u-${WORLD.slice(0, 12)}`}, 'Usages')`.execute(
      owner,
    );
    for (const city of [CITY, OTHER_CITY])
      await sql`insert into game.cities (id, world_id, slug, name) values (${city}, ${WORLD}, ${`c-${city.slice(0, 8)}`}, 'Cité')`.execute(
        owner,
      );
    const [first, second] = [await house(), await house()];
    for (const houseId of [first, first, second]) await site(houseId);
    await owner
      .insertInto('game.npc_population')
      .values([
        { world_id: WORLD, city_id: CITY, class_id: CLASS, population: 25 },
        { world_id: WORLD, city_id: OTHER_CITY, class_id: CLASS, population: 0 },
      ])
      .execute();
  });
  afterAll(async () => {
    await sql`delete from game.sites where recipe_id = ${RECIPE}`.execute(owner);
    await sql`delete from game.npc_population where class_id = ${CLASS}`.execute(owner);
    const held = await db
      .selectFrom('game.inventories')
      .select(['id', 'quantity'])
      .where('good_id', '=', GOOD)
      .where('quantity', '>', '0')
      .execute();
    for (const stock of held) await moveToken(stock.id, Number(stock.quantity), true);
  });
  const publish = async (config: unknown) =>
    (await send(designer, 'admin.publishConfig', { config })).body.data?.versionId ?? '';
  /** API dont la version en vigueur est `config` (#234) ; `null` : aucune version en vigueur lisible. */
  const loaded = (config: unknown) => {
    const valid = validateConfig(config);
    if (!valid.ok) throw new Error(valid.errors.join('\n'));
    return { ...TEST_CONFIG, config: valid.config };
  };
  const appWith = (loadConfig: ConfigSource) =>
    createApp({ db, telemetry, verifyToken: testVerifier, rateLimiter: unlimited, loadConfig });
  const inForce = (config: unknown) => {
    const active = config === null ? null : loaded(config);
    return appWith(async () => {
      if (!active) throw new ConfigError('No active configuration');
      return active;
    });
  };
  // Sauf mention contraire, la version en vigueur connaît la recette et la classe : les retirer se confirme.
  const withBoth = inForce(WITH_BOTH);
  /** Ce qu'Olympe montre de chaque version avant sa programmation, réduit aux éléments de ce test. */
  const readUsage = async (via: typeof app) => {
    const res = await via.request('/api/admin/config/versions', {
      headers: { authorization: `Bearer aal2:${root}` },
    });
    const { data } = (await res.json()) as {
      data: { versions: { id: string; retiredInUse: unknown; alreadyRetiredInUse: unknown }[] };
    };
    const ours = (usage: Omit<RetiredUsage, 'goods'>) => ({
      recipes: usage.recipes.filter((entry) => entry.recipeId === RECIPE),
      npcClasses: usage.npcClasses.filter((entry) => entry.classId === CLASS),
    });
    return new Map(
      data.versions.map((version) => {
        const usage = retiredUsageSchema.parse(version.retiredInUse);
        const already = alreadyRetiredUsageSchema.parse(version.alreadyRetiredInUse);
        const goods = usage.goods.filter((entry) => entry.goodId === GOOD);
        return [version.id, { retired: { goods, ...ours(usage) }, already: ours(already) }];
      }),
    );
  };
  const retiredInUse = async () =>
    new Map([...(await readUsage(withBoth))].map(([id, usage]) => [id, usage.retired]));
  const recipes = [{ recipeId: RECIPE, sites: 3, houses: 2 }];
  // Une classe vide garde un état : la cité compte, à zéro habitant.
  const npcClasses = [{ classId: CLASS, cities: 2, population: 25 }];

  it('compte, sous chaque version, les sites et maisons d’une recette retirée et la population d’une classe retirée', async () => {
    const [without, withRecipe, withBoth] = [
      await publish(SAME_CLOCK),
      await publish(WITH_RECIPE),
      await publish(WITH_BOTH),
    ];
    const usage = await retiredInUse();
    expect(usage.get(without)).toEqual({ goods: [], recipes, npcClasses });
    expect(usage.get(withRecipe)).toEqual({ goods: [], recipes: [], npcClasses });
    expect(usage.get(withBoth)).toEqual({ goods: [], recipes: [], npcClasses: [] });
  });

  const activations = (versionId: string) =>
    db.selectFrom('config.activations').select('id').where('version_id', '=', versionId).execute();
  const schedule = (
    user: string,
    versionId: string,
    confirmRetiredInUse: boolean,
    via = withBoth,
  ) => send(user, 'admin.scheduleConfig', { versionId, confirmRetiredInUse }, { via });
  /** Liste confirmée gardée par l'événement de la programmation. */
  const confirmedRetired = async (versionId: string) => {
    const events = await sql<{ confirmed: unknown }>`
      select payload->'confirmedRetired' as confirmed from game.domain_events
      where type = 'ConfigActivationScheduled' and payload->>'versionId' = ${versionId}
      order by seq`.execute(db);
    return events.rows.map((row) => row.confirmed);
  };
  const ids = async (query: string) =>
    (await sql<{ id: string }>`${sql.raw(query)}`.execute(db)).rows.map((row) => row.id);
  /**
   * Version qui garde tout ce que le monde porte encore, lu dans la base partagée au moment du test :
   * biens détenus ou en carnet, recettes exploitées, classes avec un état y sont ajoutés s'ils manquent.
   */
  const keepingAll = async () => {
    const missing = (known: readonly { id: string }[], inUse: string[]) =>
      inUse.filter((id) => !known.some((entry) => entry.id === id));
    const goods = missing(
      SAME_CLOCK.goods,
      await ids(`select good_id as id from game.inventories where quantity > 0
                 union select good_id from game.orders where status = 'open'`),
    );
    const recipes = missing(
      SAME_CLOCK.recipes,
      await ids('select distinct recipe_id as id from game.sites'),
    );
    const classes = missing(
      SAME_CLOCK.npcClasses,
      await ids('select distinct class_id as id from game.npc_population'),
    );
    const [good] = SAME_CLOCK.goods;
    return {
      ...SAME_CLOCK,
      goods: [...SAME_CLOCK.goods, ...goods.map((id) => ({ ...good, id }))],
      recipes: [...SAME_CLOCK.recipes, ...recipes.map((id) => ({ ...recipe, id }))],
      npcClasses: [...SAME_CLOCK.npcClasses, ...classes.map((id) => ({ ...npcClass, id }))],
      cities: SAME_CLOCK.cities.map((city) => ({
        ...city,
        population: { ...city.population, ...Object.fromEntries(classes.map((id) => [id, 10])) },
      })),
    };
  };

  it('sans confirmation, la programmation est refusée et nomme chaque élément ; confirmée, elle passe', async () => {
    const [without, withBoth] = [await publish(SAME_CLOCK), await publish(WITH_BOTH)];
    const reviewer = await newUser('game_designer', root);
    const refused = await schedule(reviewer, without, false);
    expect(refused).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFIG_RETIRED_UNCONFIRMED' } },
    });
    expect(refused.body.error?.fields).toEqual(
      expect.arrayContaining([`recipes.${RECIPE}`, `npcClasses.${CLASS}`]),
    );
    expect(await activations(without)).toEqual([]);
    expect(await logOf(reviewer)).toEqual([
      {
        command: 'admin.scheduleConfig',
        status: 'rejected',
        error_code: 'CONFIG_RETIRED_UNCONFIRMED',
      },
    ]);
    // Une version qui garde la recette et la classe ne les nomme pas (la base partagée peut porter
    // d'autres éléments en usage, laissés par d'autres suites : elle est alors refusée pour eux).
    // Le statut et le code d'abord : une autre cause de refus ne passe pas pour une absence de champ.
    const kept = await schedule(reviewer, withBoth, false);
    expect([200, 409]).toContain(kept.status);
    expect(kept.body.error?.code ?? 'OK').toBe(
      kept.status === 200 ? 'OK' : 'CONFIG_RETIRED_UNCONFIRMED',
    );
    expect(kept.body.error?.fields ?? []).not.toContain(`recipes.${RECIPE}`);
    expect(kept.body.error?.fields ?? []).not.toContain(`npcClasses.${CLASS}`);

    // Confirmée, elle est programmée ; rien n'est changé aux sites ni à la population. L'événement garde
    // ce qui a été confirmé.
    expect((await schedule(reviewer, without, true)).status).toBe(200);
    expect(await activations(without)).toHaveLength(1);
    expect((await retiredInUse()).get(without)).toEqual({ goods: [], recipes, npcClasses });
    const [confirmed] = await confirmedRetired(without);
    expect(confirmed).toEqual(expect.arrayContaining([`recipes.${RECIPE}`, `npcClasses.${CLASS}`]));
  });

  it('un client qui n’envoie pas le champ (antérieur à #200) est refusé comme sans confirmation', async () => {
    const versionId = await publish(SAME_CLOCK);
    // Corps tel quel : `send` ajouterait la confirmation.
    const res = await withBoth.request('/api/commands/admin.scheduleConfig', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer aal2:${root}`,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({ versionId }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; fields: string[] } };
    expect(body.error.code).toBe('CONFIG_RETIRED_UNCONFIRMED');
    expect(body.error.fields).toEqual(
      expect.arrayContaining([`recipes.${RECIPE}`, `npcClasses.${CLASS}`]),
    );
    expect(await activations(versionId)).toEqual([]);
  });

  it('une version qui ne retire rien en usage se programme sans confirmation ; l’événement n’en garde aucune', async () => {
    const versionId = await publish(await keepingAll());
    expect((await retiredInUse()).get(versionId)).toEqual({
      goods: [],
      recipes: [],
      npcClasses: [],
    });
    expect(await schedule(root, versionId, false)).toMatchObject({ status: 200 });
    expect(await confirmedRetired(versionId)).toEqual([[]]);
  });

  it('une classe que la version en vigueur a retirée, encore en base, n’impose pas de confirmation à la suivante ; l’événement ne garde que ce qui est confirmé (#234)', async () => {
    // Version suivante : sans la recette ni la classe, mais avec tout bien en usage (aucun refus #191).
    const next = await publish({
      ...(await keepingAll()),
      recipes: SAME_CLOCK.recipes,
      npcClasses: SAME_CLOCK.npcClasses,
      cities: SAME_CLOCK.cities,
    });
    const reviewer = await newUser('game_designer', root);
    // En vigueur : la recette, pas la classe. Seule la recette est retirée par `next`, et se confirme.
    const withRecipe = inForce(WITH_RECIPE);
    expect((await readUsage(withRecipe)).get(next)).toEqual({
      retired: { goods: [], recipes, npcClasses: [] },
      already: { recipes: [], npcClasses },
    });
    const refused = await schedule(reviewer, next, false, withRecipe);
    expect(refused).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFIG_RETIRED_UNCONFIRMED', fields: [`recipes.${RECIPE}`] } },
    });
    expect(await activations(next)).toEqual([]);
    expect((await schedule(reviewer, next, true, withRecipe)).status).toBe(200);
    // En vigueur : ni l'une ni l'autre. Rien à confirmer, la programmation passe telle quelle.
    const withNeither = inForce(SAME_CLOCK);
    expect((await readUsage(withNeither)).get(next)).toEqual({
      retired: { goods: [], recipes: [], npcClasses: [] },
      already: { recipes, npcClasses },
    });
    expect((await schedule(reviewer, next, false, withNeither)).status).toBe(200);
    expect(await confirmedRetired(next)).toEqual([[`recipes.${RECIPE}`], []]);
    // Sans version en vigueur lisible, la lecture tient tout pour retiré par la version : à confirmer.
    expect((await readUsage(inForce(null))).get(next)).toEqual({
      retired: { goods: [], recipes, npcClasses },
      already: { recipes: [], npcClasses: [] },
    });
  });

  it('la référence est la version en vigueur à l’instant de la transaction, lue dans celle-ci : une clôture passée depuis le chargement compte (#234)', async () => {
    const next = await publish({
      ...(await keepingAll()),
      recipes: SAME_CLOCK.recipes,
      npcClasses: SAME_CLOCK.npcClasses,
      cities: SAME_CLOCK.cities,
    });
    // Avant la transaction, la recette est déjà retirée ; dans la transaction, une clôture a mis en
    // vigueur une version qui la connaît : `next` la retire bel et bien, et doit le faire confirmer.
    const [before, after] = [loaded(SAME_CLOCK), loaded(WITH_RECIPE)];
    const calls: { at: Date; inTransaction: boolean }[] = [];
    const racing = appWith(async (at, executor) => {
      calls.push({ at, inTransaction: executor !== undefined });
      return executor ? after : before;
    });
    const reviewer = await newUser('game_designer', root);
    expect(await schedule(reviewer, next, false, racing)).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFIG_RETIRED_UNCONFIRMED', fields: [`recipes.${RECIPE}`] } },
    });
    // Le second chargement est fait à l'instant de la transaction, celui que le journal enregistre.
    const [logged] = await db
      .selectFrom('game.command_log')
      .select('created_at')
      .where('user_id', '=', reviewer)
      .execute();
    expect(calls).toEqual([
      { at: expect.any(Date), inTransaction: false },
      { at: logged?.created_at, inTransaction: true },
    ]);
  });

  it('la confirmation ne lève pas le refus d’un bien encore détenu', async () => {
    // La version retire à la fois un bien détenu et une recette exploitée, et elle est confirmée.
    const versionId = await publish(SAME_CLOCK);
    const holder = await house();
    const inventory = await db
      .insertInto('game.inventories')
      .values({ world_id: WORLD, house_id: holder, city_id: CITY, good_id: GOOD })
      .returning('id')
      .executeTakeFirstOrThrow();
    await moveToken(inventory.id, 2);
    const refused = await schedule(root, versionId, true);
    expect(refused).toMatchObject({ status: 409, body: { error: { code: 'CONFIG_GOOD_IN_USE' } } });
    expect(refused.body.error?.fields).toContain(`goods.${GOOD}`);
    expect(await activations(versionId)).toEqual([]);
    // Le stock rendu, la même version se programme, confirmée.
    await moveToken(inventory.id, 2, true);
    expect((await schedule(root, versionId, true)).status).toBe(200);
  });
});

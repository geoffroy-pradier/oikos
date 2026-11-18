import { randomUUID } from 'node:crypto';
import {
  ConfigError,
  DEFAULT_MODERATION,
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  scheduleActivation,
} from '@oikos/config';
import { ADMIN_ROLES, type AdminRole } from '@oikos/contracts';
import { createDb, type Db, serviceRoleUrl } from '@oikos/db';
import {
  IdentifierNode,
  OperationNodeTransformer,
  sql,
  type SchemableIdentifierNode,
} from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createTelemetry } from './telemetry';
import { createRateLimiter, unlimited } from './rate-limit';
import type { ConfigSource } from './registry';
import { TEST_CONFIG, testConfig, testConfigWithClock, testVerifier } from './test-config';

// Tests d'intégration des lectures du back-office, contre Supabase local (base partagée avec les autres
// suites : les compteurs globaux sont vérifiés par différence).
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const telemetry = createTelemetry(db);
const owner = createDb(DATABASE_URL);
const app = createApp({
  db,
  telemetry,
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
/** Versions programmées par ce fichier : leurs activations encore à venir sont annulées à la fin. */
const scheduledVersions: string[] = [];
afterAll(async () => {
  // Même contenu que la configuration de test, mais un autre identifiant : laissée en attente, elle entrerait
  // en vigueur à la clôture et changerait la version qu'enregistrent les ticks des autres suites (#354).
  // La base refuse d'annuler à moins d'une minute de l'échéance : l'activation reste alors, sans autre effet.
  await sql`insert into config.activation_cancellations (activation_id, cancelled_by)
    select a.id, ${randomUUID()} from config.activations a
    where a.version_id = any(${scheduledVersions}::uuid[])
      and a.activate_at > now() + interval '1 minute'
      and not exists (select 1 from config.activation_cancellations c where c.activation_id = a.id)`.execute(
    owner,
  );
  await Promise.all([db.destroy(), owner.destroy()]);
});

async function newUser(role?: AdminRole, grantedBy: string | null = null): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  if (role)
    await owner
      .insertInto('admin.roles')
      .values({ user_id: id, role, granted_by: grantedBy })
      .execute();
  return id;
}
const users = {} as Record<'root' | 'designer' | 'observer' | 'moderator' | 'player', string>;
beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  users.root = await newUser('super_admin');
  users.designer = await newUser('game_designer', users.root);
  users.observer = await newUser('observer', users.root);
  users.moderator = await newUser('moderator', users.root);
  users.player = await newUser();
});

interface Reply {
  status: number;
  // Les formes exactes sont vérifiées champ par champ dans les tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok: boolean; data?: any; error?: { code: string } };
}
const get = async (user: string | null, path: string, aal2 = true): Promise<Reply> => {
  const res = await app.request(`/api/admin/${path}`, {
    headers: user ? { authorization: `Bearer ${aal2 ? 'aal2:' : ''}${user}` } : {},
  });
  return { status: res.status, body: (await res.json()) as Reply['body'] };
};
const command = async (user: string, name: string, body: unknown) => {
  const res = await app.request(`/api/commands/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer aal2:${user}`,
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify(body),
  });
  return ((await res.json()) as { data?: { versionId: string; activateAt: string } }).data;
};
const ROUTES = [
  'me',
  'vigie',
  'config/versions',
  'economy',
  `config/versions/${TEST_CONFIG.id}`,
  'audit',
  'roles',
];

describe('accès aux lectures du back-office', () => {
  it('exige un jeton, le second facteur et un rôle', async () => {
    for (const route of ROUTES) {
      expect((await get(null, route)).status).toBe(401);
      expect(await get(users.player, route)).toMatchObject({
        status: 403,
        body: { ok: false, error: { code: 'FORBIDDEN' } },
      });
      expect((await get(users.root, route, false)).status).toBe(403);
    }
  });

  it('ouvre chaque module aux seuls rôles prévus', async () => {
    const allowed = async (user: string) =>
      (
        await Promise.all(
          ROUTES.slice(0, 3)
            .concat('audit', 'roles')
            .map((route) => get(user, route)),
        )
      ).map((reply) => reply.status);
    // Ordre : me, vigie, config/versions, audit, roles.
    expect(await allowed(users.root)).toEqual([200, 200, 200, 200, 200]);
    expect(await allowed(users.designer)).toEqual([200, 200, 200, 403, 403]);
    expect(await allowed(users.observer)).toEqual([200, 200, 200, 200, 403]);
    expect(await allowed(users.moderator)).toEqual([200, 403, 403, 403, 403]);
    // Chaque rôle du contrat, un compte chacun : trois lisent les tableaux de bord, deux le journal, un
    // seul la liste des rôles.
    const matrix: Record<string, number[]> = {};
    for (const role of ADMIN_ROLES) {
      matrix[role] = await allowed(await newUser(role, role === 'super_admin' ? null : users.root));
    }
    expect(matrix).toEqual({
      super_admin: [200, 200, 200, 200, 200],
      game_designer: [200, 200, 200, 403, 403],
      community_manager: [200, 403, 403, 403, 403],
      moderator: [200, 403, 403, 403, 403],
      support: [200, 403, 403, 403, 403],
      observer: [200, 200, 200, 200, 403],
    });
    // Un chemin que personne n'a déclaré n'est ouvert à aucun rôle.
    expect((await get(users.root, 'inconnu')).status).toBe(403);
    expect((await get(users.moderator, 'me')).body.data).toEqual({ role: 'moderator' });
    expect((await get(users.moderator, `config/versions/${TEST_CONFIG.id}`)).status).toBe(403);
  });

  it('un rôle retiré perd l’accès à la requête suivante', async () => {
    const former = await newUser('observer', users.root);
    expect((await get(former, 'vigie')).status).toBe(200);
    await owner.deleteFrom('admin.roles').where('user_id', '=', former).execute();
    expect((await get(former, 'vigie')).status).toBe(403);
  });
});

describe('limitation de débit des lectures', () => {
  it('au-delà de la limite, la requête est refusée avec le délai d’attente', async () => {
    const limited = createApp({
      db,
      telemetry,
      verifyToken: testVerifier,
      rateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
      loadConfig: testConfig,
    });
    const call = () =>
      limited.request('/api/admin/me', {
        headers: { authorization: `Bearer aal2:${users.observer}` },
      });
    expect([(await call()).status, (await call()).status]).toEqual([200, 200]);
    const refused = await call();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await refused.json()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });
});

describe('accès', () => {
  it('liste les comptes qui portent un rôle, du plus ancien au plus récent, et suit les commandes de rôle', async () => {
    const [guest, later] = [await newUser(), await newUser()];
    const known = [users.root, users.designer, guest, later, users.player];
    type Row = { userId: string; role: string; grantedBy: string | null; grantedAt: string };
    // Base partagée avec les autres suites : seuls les comptes de ce test sont comparés.
    const list = async () => {
      const all = (await get(users.root, 'roles')).body.data.roles as Row[];
      expect(all.map((row) => row.grantedAt)).toEqual(all.map((row) => row.grantedAt).sort());
      return all.filter((row) => known.includes(row.userId));
    };
    await command(users.root, 'admin.grantRole', { userId: guest, role: 'support' });
    await command(users.root, 'admin.grantRole', { userId: later, role: 'moderator' });
    const granted = await owner
      .selectFrom('admin.roles')
      .select('granted_at')
      .where('user_id', '=', guest)
      .executeTakeFirstOrThrow();
    // Ni adresse ni autre champ du compte : exactement ces quatre champs. Un compte sans rôle est absent.
    expect(await list()).toEqual([
      { userId: users.root, role: 'super_admin', grantedBy: null, grantedAt: expect.any(String) },
      {
        userId: users.designer,
        role: 'game_designer',
        grantedBy: users.root,
        grantedAt: expect.any(String),
      },
      {
        userId: guest,
        role: 'support',
        grantedBy: users.root,
        grantedAt: granted.granted_at.toISOString(),
      },
      { userId: later, role: 'moderator', grantedBy: users.root, grantedAt: expect.any(String) },
    ]);
    // Rôle remplacé, rôle retiré : la lecture suivante le montre.
    await command(users.root, 'admin.grantRole', { userId: guest, role: 'observer' });
    await command(users.root, 'admin.revokeRole', { userId: later });
    expect((await list()).map((row) => [row.userId, row.role])).toEqual([
      [users.root, 'super_admin'],
      [users.designer, 'game_designer'],
      [guest, 'observer'],
    ]);
  });
});

describe('Vigie', () => {
  it('montre le réglage qui lève la double validation, désactivé par défaut', async () => {
    expect((await get(users.observer, 'vigie')).body.data.selfReviewAllowed).toBe(false);
    const lenient = createApp({
      db,
      telemetry,
      verifyToken: testVerifier,
      rateLimiter: unlimited,
      loadConfig: testConfig,
      settings: { allowSelfReview: true },
    });
    const reply = await lenient.request('/api/admin/vigie', {
      headers: { authorization: `Bearer aal2:${users.observer}` },
    });
    expect(((await reply.json()) as Reply['body']).data.selfReviewAllowed).toBe(true);
  });

  it('dit le fuseau en vigueur, le même pour tous les mondes, et s’il est inconnu de la base', async () => {
    const vigieWith = async (loadConfig: ConfigSource) => {
      const reply = await createApp({
        db,
        telemetry,
        verifyToken: testVerifier,
        rateLimiter: unlimited,
        loadConfig,
      }).request('/api/admin/vigie', {
        headers: { authorization: `Bearer aal2:${users.observer}` },
      });
      expect(reply.status).toBe(200);
      return ((await reply.json()) as Reply['body']).data.clock;
    };
    const worlds = async () =>
      Number(
        (await sql<{ n: string }>`select count(*) as n from game.worlds`.execute(db)).rows[0]?.n,
      );
    const clock = TEST_CONFIG.config.clock;
    // Fuseau connu : nommé, sans alerte. Le nombre de mondes est lu entre deux comptages, d'autres
    // suites pouvant en créer au même moment.
    const fewest = await worlds();
    const known = await vigieWith(testConfig);
    expect(known).toEqual({
      timezone: clock.timezone,
      knownToDatabase: true,
      worlds: expect.any(Number) as number,
      invalidConfig: false,
    });
    expect(known.worlds).toBeGreaterThanOrEqual(fewest);
    expect(known.worlds).toBeLessThanOrEqual(await worlds());
    expect(fewest).toBeGreaterThan(0);
    // Connu à la casse près, comme à la publication et pour `at time zone`.
    expect(
      await vigieWith(testConfigWithClock({ ...clock, timezone: 'europe/paris' })),
    ).toMatchObject({ timezone: 'europe/paris', knownToDatabase: true });
    // Sorti de la base des fuseaux (2020), encore accepté par `Intl` : signalé et nommé. La base ne sait
    // pas le lire, d'où le jour de jeu nul de `game.clock_rules()`.
    expect(
      await vigieWith(testConfigWithClock({ ...clock, timezone: 'US/Pacific-New' })),
    ).toMatchObject({ timezone: 'US/Pacific-New', knownToDatabase: false });
    await expect(sql`select now() at time zone 'US/Pacific-New'`.execute(db)).rejects.toThrow(
      /time zone "US\/Pacific-New" not recognized/,
    );
  });

  it('sans version en vigueur, la Vigie le dit et reste lisible', async () => {
    class Rollback extends Error {}
    /** Lit et écrit `to` au lieu du schéma `config` : une base sans version, sans toucher à la vraie. */
    class SchemaSwap extends OperationNodeTransformer {
      constructor(private readonly to: string) {
        super();
      }
      protected override transformSchemableIdentifier(
        node: SchemableIdentifierNode,
      ): SchemableIdentifierNode {
        const swapped = super.transformSchemableIdentifier(node);
        return swapped.schema?.name === 'config'
          ? { ...swapped, schema: IdentifierNode.create(this.to) }
          : swapped;
      }
    }
    const clock = await owner
      .transaction()
      .execute(async (trx: Db) => {
        const schema = `config_empty_${randomUUID().replaceAll('-', '')}`;
        await sql`create schema ${sql.id(schema)}`.execute(trx);
        await sql`create table ${sql.id(schema, 'versions')} (id uuid, payload jsonb)`.execute(trx);
        const none: ConfigSource = () => Promise.reject(new ConfigError('No active configuration'));
        const app = createApp({
          db: trx.withPlugin({
            transformQuery: ({ node }) => new SchemaSwap(schema).transformNode(node),
            transformResult: ({ result }) => Promise.resolve(result),
          }),
          telemetry,
          verifyToken: testVerifier,
          rateLimiter: unlimited,
          loadConfig: none,
        });
        const reply = await app.request('/api/admin/vigie', {
          headers: { authorization: `Bearer aal2:${users.observer}` },
        });
        expect(reply.status).toBe(200);
        const { data } = (await reply.json()) as Reply['body'];
        // La file de la modération reste lisible, au seuil par défaut de la configuration (#530), sans durée de
        // sanction : aucune commande ne passe sans version en vigueur (#541).
        const reports = await app.request('/api/admin/reports', {
          headers: { authorization: `Bearer aal2:${users.moderator}` },
        });
        expect(reports.status).toBe(200);
        const queue = (await reports.json()) as {
          data: { staleAfterHours: unknown; sanctionHours: unknown };
        };
        throw new Rollback(
          JSON.stringify({
            clock: data.clock,
            staleReports: data.staleReports,
            staleAfterHours: queue.data.staleAfterHours,
            sanctionHours: queue.data.sanctionHours,
          }),
        );
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
        return JSON.parse(error.message) as unknown;
      });
    expect(clock).toEqual({
      clock: null,
      staleReports: null,
      staleAfterHours: DEFAULT_MODERATION.staleReportHours,
      sanctionHours: null,
    });
  });

  it('une version en vigueur hors du schéma est dite telle, avec son fuseau tel qu’enregistré', async () => {
    class Rollback extends Error {}
    class Displaced extends Error {}
    // Version écrite hors de `publishVersion` et activée dans une transaction annulée : la base partagée
    // n'en garde rien. La Vigie y lit par le vrai chargeur, qui la refuse (`ConfigError`).
    // La base est partagée entre fichiers de tests : une activation immédiate validée par un autre test
    // après le début de cette transaction porte une heure plus tardive et passe devant celle-ci. Le test
    // vérifie donc, après la lecture, que sa version était toujours en vigueur, et sinon recommence.
    const attempt = (payload: unknown) =>
      db
        .transaction()
        .execute(async (trx: Db) => {
          const version = await trx
            .insertInto('config.versions')
            .values({ payload: JSON.stringify(payload), note: 'hors schéma' })
            .returning('id')
            .executeTakeFirstOrThrow();
          await scheduleActivation(trx, version.id);
          const loader = createConfigLoader(trx);
          // L'activation porte l'heure de la base à la microseconde, une `Date` est tronquée à la
          // milliseconde : lue dans la même milliseconde, l'activation serait encore future et la
          // version précédente, valide, serait en vigueur. Une milliseconde de plus l'évite.
          const instant = new Date(Date.now() + 1);
          const loaded = await loader.at(instant).then(
            () => null,
            (error: unknown) => error,
          );
          const reply = await createApp({
            db: trx,
            telemetry,
            verifyToken: testVerifier,
            rateLimiter: unlimited,
            loadConfig: loader.at,
          }).request('/api/admin/vigie', {
            headers: { authorization: `Bearer aal2:${users.observer}` },
          });
          const { rows } = await sql<{ displaced: boolean }>`
            select exists (
              select 1 from config.activations other, config.activations own
              where own.version_id = ${version.id} and other.version_id <> ${version.id}
                and (other.activate_at, other.seq) > (own.activate_at, own.seq)
                and other.activate_at <= greatest(clock_timestamp(), ${instant})
            ) as displaced`.execute(trx);
          if (rows[0]?.displaced) throw new Displaced();
          expect(loaded).toBeInstanceOf(ConfigError);
          expect((loaded as Error).message).toMatch(/is invalid: /);
          expect(reply.status).toBe(200);
          const { data } = (await reply.json()) as NonNullable<Reply['body']> & {
            data: { clock: unknown; ai: unknown };
          };
          // Sans configuration lisible, pas de chiffres de la passerelle IA : ni plafond ni coupure inventés.
          expect(data.ai).toBeNull();
          throw new Rollback(JSON.stringify(data.clock));
        })
        .then(
          () => expect.unreachable(),
          (error: unknown) => {
            if (error instanceof Displaced) return 'displaced' as const;
            if (!(error instanceof Rollback)) throw error;
            return JSON.parse(error.message) as Record<string, unknown>;
          },
        );
    const clockWhenInForce = async (payload: unknown) => {
      for (let tries = 0; tries < 5; tries++) {
        const clock = await attempt(payload);
        if (clock !== 'displaced') return clock;
      }
      throw new Error(
        'une activation concurrente a pris la place de la version cinq fois de suite',
      );
    };
    // Fuseau inconnu de la base dans une version illisible : les deux sont signalés.
    expect(await clockWhenInForce({ clock: { timezone: 'US/Pacific-New' } })).toMatchObject({
      timezone: 'US/Pacific-New',
      knownToDatabase: false,
      invalidConfig: true,
    });
    expect(await clockWhenInForce({ clock: { timezone: 'Europe/Paris' } })).toMatchObject({
      timezone: 'Europe/Paris',
      knownToDatabase: true,
      invalidConfig: true,
    });
    // Fuseau absent, ou qui n'est pas une chaîne : nul, jamais « aucune configuration en vigueur ».
    for (const payload of [{ goods: [] }, { clock: { timezone: 7 } }, { clock: 'Europe/Paris' }]) {
      expect(await clockWhenInForce(payload)).toMatchObject({
        timezone: null,
        knownToDatabase: null,
        invalidConfig: true,
      });
    }
  });

  it('passerelle IA : coût du jour et du mois (UTC), plafond, rejets et coupure de chaque usage', async () => {
    const usage = (patch: object) => ({
      enabled: true,
      model: 'small',
      timeoutMs: 1_000,
      maxOutputTokens: 100,
      capShareBps: 5_000,
      inputMicroEurosPerThousandTokens: 0,
      outputMicroEurosPerThousandTokens: 1_000,
      ...patch,
    });
    // Plafonds : la chronique a un plafond immense, l'intendant un plafond déjà dépassé, l'oracle est coupé.
    const ai = {
      ...TEST_CONFIG.config.ai,
      budgetMicroEurosPerActivePlayerMonth: 100_000,
      expectedActivePlayers: 1_000_000,
      usages: {
        oracle: usage({ enabled: false }),
        chronicle: usage({}),
        steward: usage({ capShareBps: 0 }),
      },
    };
    let current = ai;
    const withAi = createApp({
      db,
      telemetry,
      verifyToken: testVerifier,
      rateLimiter: unlimited,
      loadConfig: async () => ({ ...TEST_CONFIG, config: { ...TEST_CONFIG.config, ai: current } }),
    });
    const read = async () => {
      const res = await withAi.request('/api/admin/vigie', {
        headers: { authorization: `Bearer aal2:${users.observer}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Reply['body'];
      return body.data.ai as {
        usage: string;
        cut: string | null;
        capMicroEuros: number;
        spentTodayMicroEuros: number;
        spentMonthMicroEuros: number;
        answeredMonth: number;
        rejectedMonth: number;
      }[];
    };
    // Le journal est partagé et en ajout seul : on compte par différence.
    const before = await read();
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonth = new Date(monthStart.getTime() - 1);
    const earlierToday = new Date(
      Math.max(
        now.getTime() - 60_000,
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      ),
    );
    // Plus tôt dans le mois, hors du jour (sauf le 1er du mois, où ce serait aujourd'hui).
    const earlierThisMonth = now.getUTCDate() > 1;
    const calls: [string, string, number, Date][] = [
      ...(earlierThisMonth
        ? [['chronicle', 'ok', 1_000, monthStart] as [string, string, number, Date]]
        : []),
      ['chronicle', 'ok', 500, earlierToday],
      ['chronicle', 'invalid', 70, earlierToday],
      ['chronicle', 'capped', 0, earlierToday],
      ['chronicle', 'ok', 9_000, lastMonth],
    ];
    for (const [name, outcome, cost, at] of calls)
      await sql`insert into telemetry.ai_calls
          (usage, model, input_tokens, output_tokens, cost_micro_euros, outcome, duration_ms, called_at)
        values (${name}, 'small', 0, 0, ${cost}, ${outcome}, 0, ${at})`.execute(owner);
    const after = await read();
    expect(after.map((row) => [row.usage, row.cut])).toEqual([
      ['oracle', 'disabled'],
      ['chronicle', null],
      ['steward', 'capped'],
    ]);
    const chronicle = (rows: typeof after) => rows.find((row) => row.usage === 'chronicle');
    expect(chronicle(after)?.capMicroEuros).toBe(50_000_000_000);
    const delta = (
      key: 'spentTodayMicroEuros' | 'spentMonthMicroEuros' | 'answeredMonth' | 'rejectedMonth',
    ) => (chronicle(after)?.[key] ?? 0) - (chronicle(before)?.[key] ?? 0);
    // L'appel du mois précédent n'entre ni dans le jour ni dans le mois ; l'appel plafonné ne compte pas
    // comme une réponse.
    expect([delta('spentMonthMicroEuros'), delta('answeredMonth'), delta('rejectedMonth')]).toEqual(
      earlierThisMonth ? [1_570, 3, 1] : [570, 2, 1],
    );
    expect(delta('spentTodayMicroEuros')).toBe(570);

    // Coupure par la dépense : plafond de l'intendant = sa dépense du mois + la réserve d'un appel
    // (100 jetons × 1 000 µ€ le millier = 100 µ€). Il reste ouvert, puis un micro-euro de plus le coupe.
    const steward = (rows: typeof after) => rows.find((row) => row.usage === 'steward');
    const spent = steward(after)?.spentMonthMicroEuros ?? 0;
    current = {
      ...ai,
      budgetMicroEurosPerActivePlayerMonth: spent + 100,
      expectedActivePlayers: 1,
      usages: {
        ...ai.usages,
        chronicle: usage({ enabled: false }),
        steward: usage({ capShareBps: 10_000 }),
      },
    };
    expect(steward(await read())?.cut).toBeNull();
    await sql`insert into telemetry.ai_calls
        (usage, model, input_tokens, output_tokens, cost_micro_euros, outcome, duration_ms, called_at)
      values ('steward', 'small', 0, 0, 1, 'ok', 0, ${now})`.execute(owner);
    expect(steward(await read())?.cut).toBe('capped');
  });

  it('compte les commandes et montre les ticks récents, échecs compris', async () => {
    const before = (await get(users.observer, 'vigie')).body.data;
    const worldId = randomUUID();
    // Deux insertions distinctes : l'ordre d'affichage suit l'heure d'écriture.
    for (const run of [
      { tick_index: 41, status: 'done', duration_ms: 12, error: null },
      { tick_index: 42, status: 'failed', duration_ms: 9999, error: 'panne' },
    ] as const) {
      await db
        .insertInto('telemetry.tick_runs')
        .values({ world_id: worldId, ...run })
        .execute();
    }
    // Une clôture en échec sur une maison : comptée, et sa dernière erreur affichée telle quelle.
    const closeError = `Close step siteUpkeep failed on house ${randomUUID()}: boom`;
    await db
      .insertInto('telemetry.close_runs')
      .values({
        world_id: worldId,
        game_day: 20_771,
        status: 'failed',
        duration_ms: 5,
        error: closeError,
      })
      .execute();
    // Une commande refusée d'un compte encore jamais vu : un compte actif et un refus de plus.
    await command(await newUser(), 'admin.scheduleConfig', { versionId: randomUUID() });

    const after = (await get(users.observer, 'vigie')).body.data;
    expect(after.commands24h.rejected).toBeGreaterThanOrEqual(before.commands24h.rejected + 1);
    expect(after.activeAccounts24h).toBeGreaterThanOrEqual(before.activeAccounts24h + 1);
    expect(after.ticks24h.failed).toBeGreaterThanOrEqual(before.ticks24h.failed + 1);
    expect(after.ticks24h.maxDurationMs).toBeGreaterThanOrEqual(9999);
    expect(after.closes24h.failed).toBeGreaterThanOrEqual(before.closes24h.failed + 1);
    // La plus récente, la nôtre sauf si une autre suite en écrit une au même moment.
    expect(after.closes24h.lastError).toEqual(expect.stringMatching(/^Close step \S+ failed/));
    expect(after.houses).toBe(
      Number(
        (await sql<{ n: string }>`select count(*) as n from game.houses`.execute(db)).rows[0]?.n,
      ),
    );
    const mine = after.recentTicks.filter((tick: { worldId: string }) => tick.worldId === worldId);
    expect(mine).toMatchObject([
      { tickIndex: 42, status: 'failed', durationMs: 9999, error: 'panne' },
      { tickIndex: 41, status: 'done', durationMs: 12, error: null },
    ]);
    expect(after.recentTicks.length).toBeLessThanOrEqual(20);
    expect(after.queuePending === null || Number.isInteger(after.queuePending)).toBe(true);
  });
});

describe('paramètres et journal d’audit', () => {
  it('liste les versions et les activations, rend le contenu d’une version', async () => {
    const config = {
      ...TEST_CONFIG.config,
      starting: { ...TEST_CONFIG.config.starting, grantOboles: 3210 },
    };
    const published = await command(users.designer, 'admin.publishConfig', {
      config,
      note: 'essai de lecture',
    });
    // Même contenu que la configuration de test ; son activation est annulée à la fin du fichier.
    const harmless = await command(users.designer, 'admin.publishConfig', {
      config: TEST_CONFIG.config,
    });
    if (harmless?.versionId) scheduledVersions.push(harmless.versionId);
    // Programmée par un autre compte que son auteur : la revue par une seconde personne (15.2).
    // Confirmée : d'autres suites laissent en usage des recettes et des classes qu'elle retire (#200).
    const scheduled = await command(users.root, 'admin.scheduleConfig', {
      versionId: harmless?.versionId,
      confirmRetiredInUse: true,
    });

    const listing = (await get(users.observer, 'config/versions')).body.data;
    const active = await sql<{ id: string }>`select config.active_version_at(now()) as id`.execute(
      db,
    );
    expect(listing.activeVersionId).toBe(active.rows[0]?.id);
    expect(
      listing.versions.find((v: { id: string }) => v.id === published?.versionId),
    ).toMatchObject({ note: 'essai de lecture', createdBy: users.designer });
    const numbers = listing.versions.map((v: { number: number }) => v.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(
      listing.activations.find((a: { versionId: string }) => a.versionId === harmless?.versionId),
    ).toMatchObject({ activateAt: scheduled?.activateAt, createdBy: users.root });

    const detail = await get(users.designer, `config/versions/${published?.versionId}`);
    expect(detail.body.data).toMatchObject({
      id: published?.versionId,
      note: 'essai de lecture',
      config: { starting: { grantOboles: 3210 } },
    });
    for (const unknown of [randomUUID(), 'pas-un-identifiant']) {
      expect(await get(users.designer, `config/versions/${unknown}`)).toMatchObject({
        status: 404,
        body: { error: { code: 'CONFIG_VERSION_NOT_FOUND' } },
      });
    }
  });

  it('rachats possibles (#229) : bien retiré encore détenu et en vigueur, au prix de référence ; aucun sans configuration lisible ni au-delà des entiers sûrs', async () => {
    // Bien propre à ce test, qu'aucune version enregistrée ne connaît : toutes le retirent. Son stock est
    // rendu à un puits à la fin, sinon plus aucune version sans lui ne se programmerait (#191).
    const relic = `relic_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const [world, city] = [randomUUID(), randomUUID()];
    await sql`insert into game.worlds (id, slug, name) values (${world}, ${`r-${world.slice(0, 12)}`}, 'Rachat')`.execute(
      owner,
    );
    await sql`insert into game.cities (id, world_id, slug, name) values (${city}, ${world}, ${`c-${city.slice(0, 8)}`}, 'Agora')`.execute(
      owner,
    );
    const house = randomUUID();
    await owner
      .insertInto('game.houses')
      .values({ id: house, world_id: world, user_id: users.player, name: 'Rachat', blazon: '{}' })
      .execute();
    const { id: inventory } = await owner
      .insertInto('game.inventories')
      .values({ world_id: world, house_id: house, city_id: city, good_id: relic })
      .returning('id')
      .executeTakeFirstOrThrow();
    const move = (
      ends:
        | { from_system: string; to_inventory_id: string }
        | { from_inventory_id: string; to_system: string },
    ) =>
      owner
        .insertInto('game.stock_ledger')
        .values({ world_id: world, good_id: relic, quantity: 4, kind: 'test.relic', ...ends })
        .execute();
    await move({ from_system: 'production', to_inventory_id: inventory });
    const buybacksWith = async (loadConfig: ConfigSource) => {
      const res = await createApp({
        db,
        telemetry,
        verifyToken: testVerifier,
        rateLimiter: unlimited,
        loadConfig,
      }).request('/api/admin/config/versions', {
        headers: { authorization: `Bearer aal2:${users.observer}` },
      });
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as { data: { buybacks: { goodId: string }[] } };
      return data.buybacks.filter((entry) => entry.goodId === relic);
    };
    const priced =
      (referencePriceOboles: number): ConfigSource =>
      async () => ({
        ...TEST_CONFIG,
        config: {
          ...TEST_CONFIG.config,
          goods: [
            ...TEST_CONFIG.config.goods,
            { id: relic, tier: 'finished', referencePriceOboles, elasticity: 1 },
          ],
        },
      });
    try {
      expect(await buybacksWith(priced(40))).toEqual([
        {
          goodId: relic,
          unitPriceOboles: 40,
          totals: { houses: 1, units: 4, cancelledOrders: 0, oboles: 160 },
        },
      ]);
      // La configuration en vigueur ne connaît pas le bien : pas de prix, pas de rachat proposé.
      expect(await buybacksWith(testConfig)).toEqual([]);
      // Sans version en vigueur lisible : la liste reste lisible, sans rachat.
      expect(
        await buybacksWith(() => Promise.reject(new ConfigError('No active configuration'))),
      ).toEqual([]);
      // 4 × 2^51 dépasse les entiers sûrs : la commande refuserait d'arrondir, rien n'est proposé.
      expect(await buybacksWith(priced(2 ** 51))).toEqual([]);
    } finally {
      await move({ from_inventory_id: inventory, to_system: 'consumption' });
    }
  });

  it('le journal d’audit montre réussites et refus, du plus récent au plus ancien, sans l’entrée', async () => {
    const [author, intruder] = [await newUser('game_designer', users.root), await newUser()];
    const published = await command(author, 'admin.publishConfig', { config: TEST_CONFIG.config });
    await command(intruder, 'admin.publishConfig', { config: TEST_CONFIG.config });

    const audit = await get(users.root, 'audit?limit=100');
    const entries: { id: string; userId: string }[] = audit.body.data.entries;
    expect(entries.find((entry) => entry.userId === author)).toMatchObject({
      command: 'admin.publishConfig',
      status: 'ok',
      errorCode: null,
      result: { versionId: published?.versionId },
    });
    expect(entries.find((entry) => entry.userId === intruder)).toMatchObject({
      command: 'admin.publishConfig',
      status: 'rejected',
      errorCode: 'FORBIDDEN',
      result: null,
    });
    // Ordre d'inscription au journal (identifiant croissant dans le temps), pas ordre des heures : l'heure
    // est celle du début de la commande, et deux commandes simultanées peuvent s'inscrire à l'envers.
    const ids = entries.map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort().reverse());
    // La configuration soumise n'est pas recopiée dans le journal rendu.
    expect(JSON.stringify(audit.body)).not.toContain('referencePriceOboles');
  });

  it('le journal ne contient que des commandes d’administration, par pages sans trou ni doublon', async () => {
    // Une commande de jeu du même compte, et 120 commandes d'administration écrites dans le même instant.
    const author = randomUUID();
    await sql`
      insert into game.command_log (user_id, command, idempotency_key, input, status, response, duration_ms)
      select ${author}, case when n = 0 then 'house.rename' else 'admin.publishConfig' end,
             'audit-' || ${author} || '-' || n, '{}', 'ok', '{"ok":true,"data":{"n":1}}', 1
      from generate_series(0, 120) as n`.execute(owner);
    const written = await sql<{ n: string }>`
      select count(*) as n from game.command_log where command like 'admin.%'`.execute(db);

    const seen: { id: string; command: string; userId: string }[] = [];
    let before = '';
    for (let page = 0; page < 1000; page++) {
      const reply = await get(users.root, `audit?limit=100000${before && `&before=${before}`}`);
      const entries = reply.body.data.entries as typeof seen;
      // La page est bornée à 100, quelle que soit la limite demandée.
      expect(entries.length).toBeLessThanOrEqual(100);
      if (entries.length === 0) break;
      seen.push(...entries);
      before = entries.at(-1)?.id ?? '';
    }
    expect(seen.length).toBeGreaterThanOrEqual(Number(written.rows[0]?.n));
    expect(new Set(seen.map((entry) => entry.id)).size).toBe(seen.length);
    expect(seen.filter((entry) => entry.userId === author)).toHaveLength(120);
    expect(seen.every((entry) => entry.command.startsWith('admin.'))).toBe(true);
    // Du plus récent au plus ancien, d'un bout à l'autre.
    const ids = seen.map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort().reverse());
    // Sans paramètre : 50 entrées ; une par une : la deuxième page commence juste après la première.
    expect((await get(users.root, 'audit')).body.data.entries).toHaveLength(50);
    const first = (await get(users.root, 'audit?limit=1')).body.data.entries;
    const second = (await get(users.root, `audit?limit=1&before=${first[0].id}`)).body.data.entries;
    expect([first[0].id, second[0].id]).toEqual(ids.slice(0, 2));
  });

  it('refuse des paramètres de pagination mal formés, sans erreur interne', async () => {
    for (const query of [
      'limit=1.5',
      'limit=0',
      'limit=-3',
      'limit=abc',
      'limit=1e3',
      'before=-271821-04-20T00:00:00.000Z',
      'before=2026-01-01T00:00:00Z',
      `before=${'9'.repeat(5000)}`,
    ]) {
      expect(await get(users.root, `audit?${query}`)).toMatchObject({
        status: 400,
        body: { ok: false, error: { code: 'VALIDATION_FAILED' } },
      });
    }
  });

  it('le journal d’audit rend le contexte de chaque commande : session, rôle du moment, version de configuration', async () => {
    const res = await app.request('/api/commands/admin.scheduleConfig', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer aal2:${users.designer}`,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({ versionId: randomUUID() }),
    });
    expect(res.status).toBe(404);
    const audit = await get(users.root, 'audit?limit=100');
    const mine = (audit.body.data.entries as { userId: string }[]).find(
      (entry) => entry.userId === users.designer,
    );
    expect(mine).toMatchObject({
      command: 'admin.scheduleConfig',
      status: 'rejected',
      aal: 'aal2',
      adminRole: 'game_designer',
      configVersionId: TEST_CONFIG.id,
    });
  });
});

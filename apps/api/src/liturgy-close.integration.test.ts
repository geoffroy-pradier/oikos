import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { liturgyEvasion, liturgyLevy, runDailyClose, type CloseStep } from '@oikos/engine';
import { gameDayAt } from '@oikos/sim';
import { sql, type KyselyPlugin } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testVerifier } from './test-config';
import { db, owner, send } from './voyage.integration-fixtures';

// Croisement de `liturgy.perform` et de la clôture (#720, relevé par la relecture ; #721), contre Supabase local. Une
// étape de la clôture est mise en pause par un greffon Kysely de sa connexion, la commande est jouée pendant ce temps,
// puis l'étape reprend : dans les deux ordres, la liturgie n'est réglée qu'une fois et aucun des deux n'attend
// l'autre en tenant ce que l'autre attend (le fichier `conflicts.integration-fixtures` fait échouer tout interblocage).
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
/** Une connexion de service nommée : la base dit si elle attend un verrou (`pg_stat_activity`). */
const named = (applicationName: string, plugin?: KyselyPlugin) => {
  const url = new URL(DATABASE_URL);
  url.searchParams.set('application_name', applicationName);
  const db = createDb(serviceRoleUrl(url.toString()));
  return plugin ? db.withPlugin(plugin) : db;
};
const tag = randomUUID().slice(0, 8);
const [performName, closeName] = [`perform-${tag}`, `close-${tag}`];
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const clock = { ...TEST_CONFIG.config.clock };
const rules = {
  ...(TEST_CONFIG.config.liturgies as NonNullable<GameConfig['liturgies']>),
  honorGain: 10,
  charisGain: 20,
  evasionHonorLoss: 40,
  maxSplendorBps: 5_000,
};
const config: GameConfig = { ...TEST_CONFIG.config, liturgies: rules };
// La version de configuration de la clôture est une vraie version de la base (clé étrangère de `daily_closes`).
let loaded: LoadedConfig = { ...TEST_CONFIG, config };
beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = { ...(await createConfigLoader(db).at(new Date())), config };
});
const DUE = 400;
const TREASURY = 1_000;

/** Un point d'arrêt : `reached` se tient dès que le greffon y est, `release` le lève. */
function gate() {
  let release = () => {};
  let reached = () => {};
  return {
    open: new Promise<void>((resolve) => (release = resolve)),
    arrived: new Promise<void>((resolve) => (reached = resolve)),
    release: () => release(),
    reach: () => reached(),
  };
}
type Gate = ReturnType<typeof gate>;
/**
 * Greffon de la connexion qui le porte : il suspend l'exécution à la fin d'une instruction, jusqu'à ce que `held` s'ouvre,
 * et la transaction attend là avec ses verrous. Sans `trigger`, il attend d'être armé (`arm`) et suspend la prochaine
 * instruction ; avec `trigger`, il suspend la première instruction dont le nœud lui convient.
 */
function pausing(held: Gate, trigger?: (node: unknown) => boolean) {
  let armed = trigger !== undefined;
  const marked = new Set<unknown>();
  const plugin: KyselyPlugin = {
    transformQuery: ({ node, queryId }) => {
      if (armed && (trigger?.(node) ?? true)) {
        armed = false;
        marked.add(queryId);
      }
      return node;
    },
    transformResult: async ({ result, queryId }) => {
      if (marked.delete(queryId)) {
        held.reach();
        await held.open;
      }
      return result;
    },
  };
  return {
    plugin,
    arm: () => {
      armed = true;
    },
  };
}

/** Table visée par une instruction (`select … from`, `insert into`), « schéma.table ». */
const tableOf = (node: unknown): string | undefined => {
  const n = node as {
    kind?: string;
    into?: { table?: { schema?: { name: string }; identifier: { name: string } } };
    from?: { froms?: { table?: { schema?: { name: string }; identifier: { name: string } } }[] };
  };
  const table = n.kind === 'InsertQueryNode' ? n.into?.table : n.from?.froms?.[0]?.table;
  return table ? `${table.schema?.name ?? ''}.${table.identifier.name}` : undefined;
};

/** Un monde à part, sa cité, sa maison dotée et sa liturgie désignée, échue à `dueAt`. */
async function newLiturgy(dueAt: Date) {
  const [worldId, cityId, houseId, user] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const liturgyId = randomUUID();
  await owner.transaction().execute(async (trx) => {
    for (const statement of [
      sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`s-${worldId.slice(0, 12)}`}, 'Test')`,
      sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Kallistè')`,
      sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`,
      sql`insert into game.houses (id, world_id, user_id, name, blazon) values (${houseId}, ${worldId}, ${user}, 'Maison', '{}')`,
      sql`insert into game.citizenships (house_id, city_id) values (${houseId}, ${cityId})`,
      sql`insert into game.accounts (world_id, kind, house_id) values (${worldId}, 'house', ${houseId})`,
      sql`with e as (insert into game.ledger_entries (world_id, kind, meta)
          values (${worldId}, 'house.starting_grant', jsonb_build_object('houseId', ${houseId}::text)) returning id)
        insert into game.ledger_lines (entry_id, account_id, amount)
        select e.id, a.id, case when a.kind = 'house' then ${TREASURY}::bigint else ${-TREASURY}::bigint end
        from e join game.accounts a on a.world_id = ${worldId}
          and ((a.kind = 'house' and a.house_id = ${houseId}) or a.system_key = 'faucet_starting_grant')`,
      // Désignée par le propriétaire de la base, gardes levées pour cette seule écriture : sa désignation demande une
      // clôture du monde.
      sql`set local session_replication_role = replica`,
      sql`insert into game.liturgies (id, world_id, city_id, house_id, season, genre, due, designated_day, due_day, due_at)
        values (${liturgyId}, ${worldId}, ${cityId}, ${houseId}, 0, 'festival', ${DUE}, 1, 2, ${dueAt})`,
    ])
      await statement.execute(trx);
  });
  return { worldId, houseId, user, liturgyId };
}

type World = Awaited<ReturnType<typeof newLiturgy>>;
const perform = (via: ReturnType<typeof createApp>, world: World) =>
  send(
    world.user,
    'liturgy.perform',
    { liturgyId: world.liturgyId, expectedDue: DUE, splendor: 0 },
    undefined,
    via,
  );
/**
 * La clôture de l'échéance : `closeAt` est l'échéance de la liturgie, que la base n'admet qu'échue (`close_at <=
 * finished_at`). Le jour de jeu est celui du jour : le monde est à part, une seule clôture s'y joue.
 */
const closeOf = (
  world: World,
  db: ReturnType<typeof createDb>,
  steps: readonly CloseStep[],
  closeAt: Date,
) =>
  runDailyClose(db, {
    worldId: world.worldId,
    gameDay: gameDayAt(new Date(), clock),
    closeAt,
    config: { at: async () => loaded },
    steps,
    now: new Date(),
  });

/** Attend que l'horloge de la base ait passé `at` : le verrou, pas un délai fixé, ordonne ce qui suit. */
async function untilPassed(at: Date) {
  for (let i = 0; i < 1_000; i++) {
    const { rows } = await sql<{
      passed: boolean;
    }>`select clock_timestamp() >= ${at} as passed`.execute(owner);
    if (rows[0]?.passed) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`The database clock never passed ${at.toISOString()}`);
}

/** Attend (sans durée fixée) qu'une connexion nommée attende un verrou : la base, pas l'horloge, le dit. */
async function untilBlocked(applicationName: string) {
  for (let i = 0; i < 500; i++) {
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from pg_stat_activity
      where application_name = ${applicationName} and wait_event_type = 'Lock'`.execute(owner);
    if ((rows[0]?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${applicationName} never waited for a lock`);
}

/** Ce qu'une liturgie a laissé : son état, ses écritures par nature, le puits, la trésorerie et la Timè de la maison. */
async function settled(world: World) {
  const { rows } = await sql<{
    status: string;
    paid: string | null;
    kinds: string[] | null;
    sink: string;
    treasury: string;
    honor: string;
  }>`select l.status, l.paid::text,
      (select array_agg(e.kind order by e.kind) from game.ledger_entries e
        where e.meta ->> 'liturgyId' = l.id::text) as kinds,
      (select balance::text from game.accounts where world_id = l.world_id and system_key = 'sink_liturgies') as sink,
      (select balance::text from game.accounts where house_id = l.house_id and kind = 'house') as treasury,
      coalesce((select honor from game.honor where house_id = l.house_id), 0)::text as honor
    from game.liturgies l where l.id = ${world.liturgyId}`.execute(owner);
  const row = rows[0];
  return row
    ? {
        status: row.status,
        paid: row.paid === null ? null : Number(row.paid),
        kinds: row.kinds ?? [],
        sink: Number(row.sink),
        treasury: Number(row.treasury),
        honor: Number(row.honor),
      }
    : undefined;
}
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;

describe('liturgy.perform croisée avec la clôture (#720)', () => {
  it('la commande tient ses verrous quand la clôture arrive : la clôture attend, puis relit sous verrou la liturgie accomplie et ne la prélève pas', async () => {
    // Échéance dans dix secondes (marge d’une `ci` chargée : la commande doit commencer avant) : la commande l'admet, puis une pause la tient avant sa validation, ses verrous pris
    // (Timè, liturgie, agora, trésorerie) et son écriture faite. La clôture, jouée à l'échéance, ne la voit que quand elle a passé.
    const dueAt = new Date(Date.now() + 10_000);
    const world = await newLiturgy(dueAt);
    const held = gate();
    const paused = pausing(held, (node) => tableOf(node) === 'game.ledger_lines');
    const performing = perform(createApp(appOptions(named(performName, paused.plugin))), world);
    await held.arrived;
    await untilPassed(dueAt);
    const closed = closeOf(world, named(closeName), [liturgyEvasion, liturgyLevy], dueAt);
    await untilBlocked(closeName);
    // Rien n'est validé : la commande attend de pouvoir finir, la clôture de pouvoir lire.
    expect(await settled(world)).toMatchObject({
      status: 'assigned',
      paid: null,
      kinds: [],
      sink: 0,
    });
    held.release();
    const [outcome, reply] = await Promise.all([closed, performing]);
    expect(reply.status).toBe(200);
    expect(outcome.status).toBe('done');
    // Ni dérobade (Timè perdue) ni prélèvement : la maison a payé une fois, au puits, et gardé sa Timè gagnée.
    expect(outcome.summary).toMatchObject({
      liturgyEvasion: { evaded: 0, honorLost: 0 },
      liturgyLevy: { levied: 0, leviedOboles: 0 },
    });
    expect(await settled(world)).toEqual({
      status: 'performed',
      paid: DUE,
      kinds: ['liturgy.perform'],
      sink: DUE,
      treasury: TREASURY - DUE,
      honor: 10,
    });
  }, 30_000);

  it('la clôture tient ses verrous quand la commande arrive : la commande attend, puis trouve la liturgie prélevée, sans rien payer de plus', async () => {
    // Échue : le prélèvement d'office est celui de la clôture ; la commande qui l'atteint derrière elle attend.
    const dueAt = new Date(Date.now() - 60_000);
    const world = await newLiturgy(dueAt);
    // La clôture se met en pause dès qu'elle a verrouillé la Timè de la maison et la liturgie (l'étape le dit par `at`).
    const held = gate();
    const closing = pausing(held);
    const pausedEvasion: CloseStep = {
      name: liturgyEvasion.name,
      run: (context) =>
        liturgyEvasion.run({
          ...context,
          at: (subject) => {
            context.at?.(subject);
            if (subject === `liturgy ${world.liturgyId}`) closing.arm();
          },
        }),
    };
    const closed = closeOf(
      world,
      named(closeName, closing.plugin),
      [pausedEvasion, liturgyLevy],
      dueAt,
    );
    await held.arrived;
    const performing = perform(createApp(appOptions(named(performName))), world);
    await untilBlocked(performName);
    expect(await settled(world)).toMatchObject({
      status: 'assigned',
      paid: null,
      kinds: [],
      sink: 0,
    });
    held.release();
    const [outcome, reply] = await Promise.all([closed, performing]);
    expect(outcome.status).toBe('done');
    expect(outcome.summary).toMatchObject({
      liturgyEvasion: { evaded: 1, honorLost: 40 },
      liturgyLevy: { levied: 1, leviedOboles: DUE },
    });
    expect(codeOf(reply)).toBe('LITURGY_SETTLED');
    expect(await settled(world)).toEqual({
      status: 'levied',
      paid: DUE,
      kinds: ['liturgy.levy'],
      sink: DUE,
      treasury: TREASURY - DUE,
      honor: -40,
    });
  });
});

function appOptions(db: ReturnType<typeof createDb>) {
  return {
    db,
    telemetry: createTelemetry(db),
    verifyToken: testVerifier,
    rateLimiter: unlimited,
    loadConfig: async () => loaded,
  };
}

import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';

// Tests d'intégration de `site.restart` contre Supabase local. Le champ de départ vient de `house.create`.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
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

const { starting, sites, recipes } = TEST_CONFIG.config;
const recipe = recipes.find((candidate) => candidate.id === starting.siteRecipeId);
if (!recipe) throw new Error('starting recipe missing from the test configuration');
const HOUR = 3_600_000;
/** Entretien d'un jour du champ de départ, au coefficient ×1 de la configuration de test : 30 oboles. */
const UPKEEP = sites.upkeep.dailyOboles[recipe.siteType];
const GRANT = starting.grantOboles;

const send = async (user: string, command: string, body: unknown, key: string = randomUUID()) => {
  const res = await app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const restart = (user: string, siteId: string, key?: string) =>
  send(user, 'site.restart', { siteId }, key);

/** Une maison fondée par la commande réelle ; son champ, âgé de `ageHours`, est à l'arrêt depuis `haltedHours`. */
async function newPlayer(ageHours = 0, haltedHours?: number) {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  const name = `Relance ${[...user.replace(/[^a-f]/g, '')].slice(0, 10).join('')}`;
  const blazon = { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' };
  const founded = await send(user, 'house.create', {
    cityId: '01900000-0000-7000-8000-000000000101',
    name,
    blazon,
  });
  const houseId = (founded.body['data'] as { houseId: string }).houseId;
  const site = await db
    .selectFrom('game.sites')
    .select('id')
    .where('house_id', '=', houseId)
    .executeTakeFirstOrThrow();
  // Garde des sites levée le temps d'antidater la création, le cycle et l'arrêt.
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = now() - ${`${ageHours * HOUR} milliseconds`}::interval,
      cycle_started_at = now() - ${`${ageHours * HOUR} milliseconds`}::interval,
      halted_at = now() - ${haltedHours === undefined ? null : `${haltedHours * HOUR} milliseconds`}::interval
      where id = ${site.id}`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
  return { user, houseId, siteId: site.id };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;
/** Trésorerie, site à l'arrêt ou non, heures de cycle écoulées, et écritures de relance de la maison. */
const stateOf = async ({ houseId, siteId }: Player) => {
  const { rows } = await sql<{
    balance: string;
    halted: boolean;
    hours: string;
    paid: string[] | null;
  }>`select
    (select balance from game.accounts where house_id = ${houseId} and kind = 'house') as balance,
    s.halted_at is not null as halted,
    round(extract(epoch from coalesce(s.halted_at, now()) - s.cycle_started_at) / 3600, 2) as hours,
    (select array_agg(l.amount order by e.created_at) from game.ledger_entries e
      join game.ledger_lines l on l.entry_id = e.id join game.accounts a on a.id = l.account_id
      where e.kind = 'upkeep.restart' and e.meta = jsonb_build_object('houseId', ${houseId}::text, 'siteId', ${siteId}::text)
        and a.system_key = 'sink_upkeep') as paid
    from game.sites s where s.id = ${siteId}`.execute(db);
  const row = rows[0];
  return {
    balance: Number(row?.balance),
    halted: row?.halted,
    hours: Number(row?.hours),
    paid: row?.paid ?? [],
  };
};
/** Retire des oboles à la maison, vers un puits, par une écriture de test. */
const drain = ({ houseId }: Player, oboles: number) =>
  sql`with entry as (insert into game.ledger_entries (world_id, kind) select world_id, 'test.drain' from game.houses where id = ${houseId} returning id, world_id)
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry.id, a.id, case when a.kind = 'house' then -${oboles}::bigint else ${oboles}::bigint end from entry, game.accounts a
    where a.world_id = entry.world_id and ((a.kind = 'house' and a.house_id = ${houseId}) or a.system_key = 'sink_offerings')`.execute(
    owner,
  );

describe('site.restart', () => {
  it('paie un jour d’entretien au puits et relance le site, son cycle gelé repris ; rejouée, la commande ne prélève rien de plus', async () => {
    // Champ de 10 heures, à l'arrêt depuis 7 : 3 heures de cycle avant l'arrêt.
    const player = await newPlayer(10, 7);
    expect(await stateOf(player)).toEqual({ balance: GRANT, halted: true, hours: 3, paid: [] });
    const key = randomUUID();
    const done = await restart(player.user, player.siteId, key);
    expect(done).toMatchObject({
      status: 200,
      body: { data: { siteId: player.siteId, upkeepOboles: UPKEEP } },
    });
    expect(UPKEEP).toBe(30);
    // 3 000 − 30 = 2 970 ; le site tourne, et son cycle en est toujours à 3 heures, pas à 10.
    expect(await stateOf(player)).toEqual({
      balance: GRANT - 30,
      halted: false,
      hours: 3,
      paid: ['30'],
    });
    expect(await restart(player.user, player.siteId, key)).toEqual(done);
    expect(await stateOf(player)).toMatchObject({ balance: GRANT - 30, paid: ['30'] });
    const events = await sql<{ payload: unknown }>`select payload from game.domain_events
      where type = 'SiteRestarted' and payload->>'siteId' = ${player.siteId}`.execute(db);
    expect(events.rows).toEqual([
      { payload: { siteId: player.siteId, houseId: player.houseId, upkeepOboles: 30 } },
    ]);
    // Avec une clé neuve : le site tourne déjà, rien n'est prélevé.
    expect(await restart(player.user, player.siteId)).toMatchObject({
      status: 409,
      body: { error: { code: 'SITE_NOT_HALTED' } },
    });
    expect(await stateOf(player)).toMatchObject({ balance: GRANT - 30, paid: ['30'] });
  });

  it('trésorerie insuffisante : refus, site toujours à l’arrêt, jamais de solde négatif ; à l’obole près, elle suffit', async () => {
    const player = await newPlayer(10, 7);
    await drain(player, GRANT - 29);
    expect(await restart(player.user, player.siteId)).toMatchObject({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_FUNDS' } },
    });
    expect(await stateOf(player)).toEqual({ balance: 29, halted: true, hours: 3, paid: [] });
    await drain(player, -1);
    expect((await restart(player.user, player.siteId)).status).toBe(200);
    expect(await stateOf(player)).toEqual({ balance: 0, halted: false, hours: 3, paid: ['30'] });
  });

  it('refuse le site d’un autre joueur, un site inconnu et une demande mal formée, sans rien écrire', async () => {
    const [player, other] = [await newPlayer(10, 7), await newPlayer()];
    expect(await restart(other.user, player.siteId)).toMatchObject({
      status: 404,
      body: { error: { code: 'SITE_NOT_FOUND' } },
    });
    expect(await restart(player.user, randomUUID())).toMatchObject({
      status: 404,
      body: { error: { code: 'SITE_NOT_FOUND' } },
    });
    expect((await send(player.user, 'site.restart', { siteId: 'x' })).status).toBe(400);
    expect(await stateOf(player)).toEqual({ balance: GRANT, halted: true, hours: 3, paid: [] });
  });

  it('deux relances simultanées du même site : une seule paie, l’autre constate qu’il tourne', async () => {
    const player = await newPlayer(10, 7);
    const results = await Promise.all([
      restart(player.user, player.siteId),
      restart(player.user, player.siteId),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await stateOf(player)).toEqual({
      balance: GRANT - 30,
      halted: false,
      hours: 3,
      paid: ['30'],
    });
  });

  it('un site dont la recette a quitté la configuration n’a plus de tarif : relancé sans rien payer', async () => {
    const player = await newPlayer(10, 7);
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
      await sql`update game.sites set recipe_id = 'retired_recipe' where id = ${player.siteId}`.execute(
        trx,
      );
      await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    });
    expect(await restart(player.user, player.siteId)).toMatchObject({
      status: 200,
      body: { data: { upkeepOboles: 0 } },
    });
    expect(await stateOf(player)).toEqual({ balance: GRANT, halted: false, hours: 3, paid: [] });
  });
});

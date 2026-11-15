import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';

// Candidature, retrait et vote à l'élection de l'archonte, contre Supabase local. Chaque test a son
// monde, avec Kallistè et Elaia : la base n'admet qu'une élection ouverte par cité.
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
const MAX_TERMS = TEST_CONFIG.config.politics?.archon.maxConsecutiveTerms ?? 0;
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');

interface Reply {
  status: number;
  // Les formes exactes sont vérifiées champ par champ dans les tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok: boolean; data?: any; error?: { code: string } };
}
async function send(user: string, command: string, body: unknown, key: string = randomUUID()) {
  const res = await app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Reply['body'] };
}
const one = async <T>(query: ReturnType<typeof sql<T>>) => (await query.execute(owner)).rows;

/** Un monde à deux cités, et une élection de Kallistè ouverte au dépôt des candidatures (sauf demande). */
async function newWorld(opened = true) {
  const [worldId, kalliste, elaia, electionId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`e-${worldId.slice(0, 12)}`}, 'Test'))
    insert into game.cities (id, world_id, slug, name) values (${kalliste}, ${worldId}, 'kalliste', 'K'), (${elaia}, ${worldId}, 'elaia', 'E')`.execute(
    owner,
  );
  /** Une maison fondée par la commande réelle, citoyenne si demandé. */
  const player = async (cityId = kalliste, citizen = true) => {
    const user = randomUUID();
    await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
      owner,
    );
    const founded = await send(user, 'house.create', {
      cityId,
      name: `Politai ${letters()}`,
      blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
    });
    expect(founded.status).toBe(200);
    const houseId = founded.body.data.houseId as string;
    if (citizen)
      await sql`update game.citizenships set status = 'citizen', since = now() where house_id = ${houseId}`.execute(
        owner,
      );
    return { user, houseId };
  };
  /** Ouvre l'élection de Kallistè, au dépôt des candidatures. */
  const open = () =>
    sql`insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
    values (${electionId}, ${worldId}, ${kalliste}, 'archon', now() - interval '1 hour', now() + interval '1 day',
      now() + interval '2 days', now() + interval '30 days')`.execute(owner);
  /** Passe l'élection au vote (calendrier avancé, garde levée le temps de le faire). */
  const startVoting = () =>
    owner.transaction().execute(async (trx) => {
      await sql`alter table game.elections disable trigger elections_guard`.execute(trx);
      await sql`update game.elections set voting_opens_at = now() - interval '1 minute' where id = ${electionId}`.execute(
        trx,
      );
      await sql`alter table game.elections enable trigger elections_guard`.execute(trx);
    });
  if (opened) await open();
  return { worldId, kalliste, elaia, electionId, player, open, startVoting };
}
type World = Awaited<ReturnType<typeof newWorld>>;
const stand = (user: string, electionId: string, key?: string) =>
  send(user, 'city.standForElection', { electionId }, key);
const eventsOf = (type: string, electionId: string) =>
  one(sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
    where type = ${type} and payload->>'electionId' = ${electionId} order by seq`).then((rows) =>
    rows.map((row) => row.payload),
  );
/**
 * Un mandat passé de Kallistè, il y a `ago` mandats : élection dépouillée, gagnée par la maison donnée
 * (candidature antidatée, garde levée), ou vacante.
 */
async function pastTerm({ worldId, kalliste }: World, ago: number, houseId: string | null) {
  await owner.transaction().execute(async (trx) => {
    const end = 28 * (ago - 1);
    const [election] = (
      await sql<{
        id: string;
      }>`insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
        values (${worldId}, ${kalliste}, 'archon', now() - ${`${end + 35} days`}::interval, now() - ${`${end + 31} days`}::interval,
          now() - ${`${end + 28} days`}::interval, now() - ${`${end} days`}::interval + interval '1 hour')
        returning id`.execute(trx)
    ).rows;
    await sql`update game.elections set tallied_at = now() where id = ${election?.id ?? ''}`.execute(
      trx,
    );
    if (!houseId) return;
    await sql`alter table game.candidacies disable trigger candidacies_guard`.execute(trx);
    await sql`insert into game.candidacies (election_id, house_id, created_at) values (${election?.id ?? ''}, ${houseId}, now() - ${`${end + 33} days`}::interval)`.execute(
      trx,
    );
    await sql`alter table game.candidacies enable trigger candidacies_guard`.execute(trx);
    await sql`insert into game.offices (world_id, city_id, office, house_id, election_id, starts_at, ends_at)
      select world_id, city_id, office, ${houseId}, id, voting_closes_at, term_ends_at from game.elections where id = ${election?.id ?? ''}`.execute(
      trx,
    );
  });
}

describe('city.standForElection', () => {
  it('un citoyen se présente une fois', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const key = randomUUID();
    const filed = await stand(alice.user, world.electionId, key);
    expect(filed).toMatchObject({
      status: 200,
      body: { data: { electionId: world.electionId, cityId: world.kalliste } },
    });
    const candidacyId = filed.body.data.candidacyId as string;
    // Rejouée avec la même clé : même réponse, aucune seconde candidature.
    expect(await stand(alice.user, world.electionId, key)).toEqual(filed);
    expect((await stand(alice.user, world.electionId)).body.error?.code).toBe('ALREADY_CANDIDATE');
    expect(await eventsOf('CandidacyFiled', world.electionId)).toEqual([
      { candidacyId, electionId: world.electionId, cityId: world.kalliste, houseId: alice.houseId },
    ]);
  });

  it('seul un citoyen de la cité se présente, pendant le dépôt, à une élection de son monde', async () => {
    const world = await newWorld();
    const metic = await world.player(world.kalliste, false);
    const foreigner = await world.player(world.elaia);
    const citizen = await world.player();
    expect((await stand(metic.user, world.electionId)).body.error?.code).toBe('NOT_CITIZEN');
    expect((await stand(foreigner.user, world.electionId)).body.error?.code).toBe('NOT_CITIZEN');
    expect((await stand(citizen.user, randomUUID())).body.error?.code).toBe('ELECTION_NOT_FOUND');
    expect((await stand(randomUUID(), world.electionId)).body.error?.code).toBe('HOUSE_NOT_FOUND');
    const filed = await stand(citizen.user, world.electionId);
    await world.startVoting();
    expect((await stand(foreigner.user, world.electionId)).body.error?.code).toBe('NOT_CITIZEN');
    const late = await world.player();
    expect((await stand(late.user, world.electionId)).body.error?.code).toBe('FILING_CLOSED');
    expect(filed.status).toBe(200);
    expect(await eventsOf('CandidacyFiled', world.electionId)).toHaveLength(1);
  });

  // Mandats passés, du plus ancien au plus récent (A, B : maisons ; null : vacance), et réponse à la
  // candidature de A au mandat suivant.
  it.each([
    [['A', 'A'], 'TERM_LIMIT_REACHED'],
    [['B', 'A', 'A'], 'TERM_LIMIT_REACHED'],
    [['A', null, 'A'], 'ok'],
    [['A', 'B', 'A'], 'ok'],
    [['A', 'A', null], 'ok'],
    [['A'], 'ok'],
  ] as const)(
    `limite de ${MAX_TERMS} mandats consécutifs, suite %j : %s`,
    async (history, expected) => {
      expect(MAX_TERMS).toBe(2);
      const world = await newWorld(false);
      const houses = { A: await world.player(), B: await world.player() };
      for (const [rank, holder] of history.entries())
        await pastTerm(world, history.length - rank, holder ? houses[holder].houseId : null);
      await world.open();
      const reply = await stand(houses.A.user, world.electionId);
      expect(reply.body.error?.code ?? 'ok').toBe(expected);
      // Une autre maison se présente toujours.
      expect((await stand(houses.B.user, world.electionId)).status).toBe(200);
    },
  );
});

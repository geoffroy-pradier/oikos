import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import type { ConfigSource } from './registry';
import { createTelemetry } from './telemetry';
import { testConfig, testVerifier } from './test-config';

/**
 * Jeu d'essai des tests d'intégration de la discussion (#273), contre Supabase local : un monde neuf par test,
 * avec Kallistè et Elaia, et des maisons fondées par la commande réelle.
 */
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const db = createDb(serviceRoleUrl(DATABASE_URL));
export const owner = createDb(DATABASE_URL);
export const appWith = (loadConfig: ConfigSource) =>
  createApp({
    db,
    telemetry: createTelemetry(db),
    verifyToken: testVerifier,
    rateLimiter: unlimited,
    loadConfig,
  });
const app = appWith(testConfig);
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');

export interface Reply {
  status: number;
  replayed: string | null;
  // Les formes exactes sont vérifiées champ par champ dans les tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok: boolean; data?: any; error?: { code: string } };
}
export interface SendOptions {
  key?: string;
  via?: ReturnType<typeof createApp>;
}
export async function send(
  user: string,
  command: string,
  body: unknown,
  { key = randomUUID(), via = app }: SendOptions = {},
): Promise<Reply> {
  const res = await via.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    replayed: res.headers.get('Idempotent-Replay'),
    body: (await res.json()) as Reply['body'],
  };
}
export const rows = async <T>(query: ReturnType<typeof sql<T>>) =>
  (await query.execute(owner)).rows;
export const codeOf = (reply: Reply) => [reply.status, reply.body.error?.code];
export const openDirect = (user: string, houseId: string, options?: SendOptions) =>
  send(user, 'chat.openDirect', { houseId }, options);

/** Un monde à deux cités ; `player` fonde une maison métèque de Kallistè (d'une autre cité, citoyenne si demandé). */
export async function newWorld() {
  const [worldId, kalliste, elaia] = [randomUUID(), randomUUID(), randomUUID()];
  await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`c-${worldId.slice(0, 12)}`}, 'Test'))
    insert into game.cities (id, world_id, slug, name) values (${kalliste}, ${worldId}, 'kalliste', 'K'), (${elaia}, ${worldId}, 'elaia', 'E')`.execute(
    owner,
  );
  const channelOf = async (cityId: string) =>
    (await rows(sql<{ id: string }>`select id from game.channels where city_id = ${cityId}`))[0]
      ?.id ?? '';
  /** `user` : un compte existant, qui fonde ici sa maison de ce monde (un compte a une maison par monde). */
  const player = async (cityId = kalliste, citizen = false, user?: string) => {
    const account = user ?? randomUUID();
    if (!user)
      await sql`insert into auth.users (id, email) values (${account}, ${`${account}@example.test`})`.execute(
        owner,
      );
    const founded = await send(account, 'house.create', {
      cityId,
      name: `Logoi ${letters()}`,
      blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
    });
    if (founded.status !== 200) throw new Error(`house.create failed: ${founded.status}`);
    const houseId = founded.body.data.houseId as string;
    if (citizen)
      await sql`update game.citizenships set status = 'citizen', since = now() where house_id = ${houseId}`.execute(
        owner,
      );
    return { user: account, houseId };
  };
  return {
    worldId,
    kalliste,
    elaia,
    player,
    kallisteChannel: await channelOf(kalliste),
    elaiaChannel: await channelOf(elaia),
  };
}

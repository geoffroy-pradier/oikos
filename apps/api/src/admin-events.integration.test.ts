import { randomUUID } from 'node:crypto';
import { ADMIN_ROLES, type AdminRole } from '@oikos/contracts';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { testConfig, testVerifier } from './test-config';
import { planEvent } from './world-events.integration-fixtures';

// Calendrier des événements du monde dans Olympe (#267), contre Supabase local.
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

/** Un compte, et son rôle accordé par un super-administrateur de ce fichier (lui-même inscrit en base). */
let root: string | undefined;
async function newUser(role?: AdminRole): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  root ??= role === 'super_admin' ? undefined : await newUser('super_admin');
  if (role)
    await owner
      .insertInto('admin.roles')
      .values({ user_id: id, role, granted_by: role === 'super_admin' ? null : root })
      .execute();
  return id;
}
const get = async (user: string, aal2 = true) => {
  const res = await app.request('/api/admin/events', {
    headers: { authorization: `Bearer ${aal2 ? 'aal2:' : ''}${user}` },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: (await res.json()) as { ok: boolean; data?: any } };
};

describe('GET /api/admin/events', () => {
  it('ouvert au concepteur de jeu, au responsable communauté et à l’observateur (et au super-administrateur)', async () => {
    const statuses: Record<string, number> = {};
    for (const role of ADMIN_ROLES) statuses[role] = (await get(await newUser(role))).status;
    expect(statuses).toEqual({
      super_admin: 200,
      game_designer: 200,
      community_manager: 200,
      moderator: 403,
      support: 403,
      observer: 200,
    });
    const designer = await newUser('game_designer');
    expect((await get(designer, false)).status).toBe(403);
    expect((await get(await newUser())).status).toBe(403);
  });

  it('rend les événements à venir, que les joueurs ne lisent pas encore, avec leur portée, sans graine', async () => {
    const worldId = randomUUID();
    await owner
      .insertInto('game.worlds')
      .values({ id: worldId, slug: `cal-${worldId.slice(0, 12)}`, name: 'Calendrier' })
      .execute();
    const cities = await owner
      .insertInto('game.cities')
      .values(['kalliste', 'elaia'].map((slug) => ({ world_id: worldId, slug, name: slug })))
      .returning(['id', 'slug'])
      .execute();
    const id = (slug: string) => cities.find((city) => city.slug === slug)?.id ?? '';
    const storm = await planEvent(owner, {
      worldId,
      model: 'storm',
      cityId: id('elaia'),
      otherCityId: id('kalliste'),
      magnitudeBps: 4_000,
      inMs: 3_600_000,
      lastsMs: 86_400_000,
    });
    const reader = await newUser('community_manager');
    const reply = await get(reader);
    expect(Date.parse(reply.body.data.now)).toBeLessThan(storm.startsAt.getTime());
    expect(reply.body.data.pastDays).toBe(30);
    // Les plus tardifs d'abord : ceux à venir passent avant ceux en cours et finis.
    const starts = reply.body.data.events.map((event: { startsAt: string }) => event.startsAt);
    expect(starts).toEqual([...starts].sort().reverse());
    const mine = reply.body.data.events.filter(
      (event: { world: string }) => event.world === `cal-${worldId.slice(0, 12)}`,
    );
    expect(mine).toEqual([
      {
        id: storm.eventId,
        world: `cal-${worldId.slice(0, 12)}`,
        model: 'storm',
        city: 'elaia',
        otherCity: 'kalliste',
        goodId: null,
        startsAt: storm.startsAt.toISOString(),
        endsAt: new Date(storm.startsAt.getTime() + 86_400_000).toISOString(),
        magnitudeBps: 4_000,
        plannedDay: 1,
      },
    ]);
    // La lecture est tracée sous sa route, avec le rôle et l'issue (15.4).
    const traces = await owner
      .selectFrom('telemetry.admin_reads')
      .select(['admin_role', 'route', 'status'])
      .where('user_id', '=', reader)
      .execute();
    expect(traces).toEqual([
      { admin_role: 'community_manager', route: '/api/admin/events', status: 200 },
    ]);
  });
});

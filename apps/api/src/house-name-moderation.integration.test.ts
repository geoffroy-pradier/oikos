import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { appWith, codeOf, db, newWorld, owner, rows, send } from './chat-test-world';
import { TEST_CONFIG } from './test-config';

// Noms de maison (#527) : filtre de vocabulaire et silence de la discussion, contre Supabase local.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const filtered = appWith(async () => ({
  ...TEST_CONFIG,
  config: {
    ...TEST_CONFIG.config,
    moderation: { ...TEST_CONFIG.config.moderation, bannedTerms: ['Maudit', 'fils de chien'] },
  },
}));
const blazon = { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' };
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 8).join('');
const account = async () => {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  return id;
};
const silence = async (user: string, seconds = 3600) =>
  sql`insert into admin.sanctions (user_id, kind, starts_at, ends_at, reason, author_id)
    values (${user}, 'silence', now() - interval '1 minute', now() + make_interval(secs => ${seconds}), 'Essai', ${await account()})`.execute(
    owner,
  );
const housesOf = (user: string) =>
  rows(sql<{ name: string }>`select name from game.houses where user_id = ${user}`);
const create = (user: string, cityId: string, name: string, via = filtered) =>
  send(user, 'house.create', { cityId, name, blazon }, { via });
const rename = (user: string, name: string, via = filtered) =>
  send(user, 'house.rename', { name }, { via });

describe('house.create', () => {
  it('refuse un terme interdit, sans casse ni accent, et fonde la maison sinon', async () => {
    const world = await newWorld();
    const user = await account();
    for (const name of ['Maison MÂUDIT', 'Fils-de-chien'])
      expect(codeOf(await create(user, world.kalliste, name))).toEqual([409, 'MESSAGE_REJECTED']);
    expect(await housesOf(user)).toEqual([]);
    const name = `Les maudits ${letters()}`;
    expect((await create(user, world.kalliste, name)).status).toBe(200);
    expect(await housesOf(user)).toEqual([{ name }]);
    // Le journal ne garde pas le nom refusé.
    const [log] = await rows(sql<{ input: unknown }>`
      select input from game.command_log where user_id = ${user} and error_code = 'MESSAGE_REJECTED' limit 1`);
    expect(log).toBeDefined();
    expect(JSON.stringify(log)).not.toMatch(/maudit|chien/i);
  });

  it('refuse un compte réduit au silence', async () => {
    const world = await newWorld();
    const user = await account();
    await silence(user);
    expect(codeOf(await create(user, world.kalliste, `Logoi ${letters()}`))).toEqual([
      409,
      'SILENCED',
    ]);
    expect(await housesOf(user)).toEqual([]);
  });
});

describe('house.rename', () => {
  it('refuse un terme interdit et garde l’ancien nom ; accepte un nom sans terme', async () => {
    const world = await newWorld();
    const { user } = await world.player();
    const [before] = await housesOf(user);
    expect(codeOf(await rename(user, 'Maison Maudit'))).toEqual([409, 'MESSAGE_REJECTED']);
    expect(await housesOf(user)).toEqual([before]);
    const name = `Maudits ${letters()}`;
    expect((await rename(user, name)).status).toBe(200);
    expect(await housesOf(user)).toEqual([{ name }]);
  });

  it('refuse un compte réduit au silence, qui renomme de nouveau à la fin de la sanction', async () => {
    const world = await newWorld();
    const { user } = await world.player();
    const [before] = await housesOf(user);
    await silence(user, 2);
    expect(codeOf(await rename(user, `Logoi ${letters()}`))).toEqual([409, 'SILENCED']);
    expect(await housesOf(user)).toEqual([before]);
    // Attend la fin du silence selon l'horloge de la base, que relit la commande.
    for (let waited = 0; ; waited += 200) {
      const [state] = await rows(sql<{ over: boolean }>`
        select bool_and(ends_at <= clock_timestamp()) as over from admin.sanctions where user_id = ${user}`);
      if (state?.over) break;
      if (waited > 10_000) throw new Error('le silence ne finit pas');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect((await rename(user, `Logoi ${letters()}`)).status).toBe(200);
  });
});

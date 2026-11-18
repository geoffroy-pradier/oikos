import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { appWith, codeOf, db, newWorld, openDirect, owner, rows, send } from './chat-test-world';
import { TEST_CONFIG } from './test-config';

// Sanctions relues à chaque commande et filtre de vocabulaire (#275), contre Supabase local. Les sanctions sont
// écrites par le test, au nom du propriétaire : les commandes d'administration viennent avec #276.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const post = (user: string, channelId: string, body: string) =>
  send(user, 'chat.post', { channelId, body });
const moderator = async () => {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  return id;
};
/** Sanction de `user`, de `from` à `to` secondes de maintenant (`to` nul : sans fin). */
async function sanction(
  user: string,
  kind: 'warning' | 'silence' | 'suspension' | 'ban',
  from: number,
  to: number | null,
  validatedBy: string | null = null,
) {
  await sql`insert into admin.sanctions (user_id, kind, starts_at, ends_at, reason, author_id, validated_by)
    values (${user}, ${kind}, now() + make_interval(secs => ${from}),
            case when ${to}::int is null then null else now() + make_interval(secs => ${to}::int) end,
            'Essai', ${await moderator()}, ${validatedBy})`.execute(owner);
}
const logged = async (user: string) =>
  rows(sql<{ command: string; status: string; error_code: string | null }>`
    select command, status, error_code from game.command_log where user_id = ${user} order by created_at`);

describe('sanctions relues à chaque commande', () => {
  it('un silence refuse chat.post, et lui seul, puis cesse à sa fin', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    await sanction(alice.user, 'silence', -60, 2);
    expect(codeOf(await post(alice.user, world.kallisteChannel, 'Chut ?'))).toEqual([
      409,
      'SILENCED',
    ]);
    expect((await openDirect(alice.user, bob.houseId)).status).toBe(200);
    expect((await post(bob.user, world.kallisteChannel, 'Bob parle.')).status).toBe(200);
    expect(
      await rows(
        sql`select count(*)::int as n from game.messages where house_id = ${alice.houseId}`,
      ),
    ).toEqual([{ n: 0 }]);
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect((await post(alice.user, world.kallisteChannel, 'De retour.')).status).toBe(200);
    expect(await logged(alice.user)).toEqual([
      { command: 'house.create', status: 'ok', error_code: null },
      { command: 'chat.post', status: 'rejected', error_code: 'SILENCED' },
      { command: 'chat.openDirect', status: 'ok', error_code: null },
      { command: 'chat.post', status: 'ok', error_code: null },
    ]);
  });

  it('une suspension refuse toute commande de jeu, pas l’appel', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    await sanction(alice.user, 'suspension', 0, 3600);
    for (const reply of [
      await post(alice.user, world.kallisteChannel, 'Bonjour'),
      await openDirect(alice.user, bob.houseId),
      await send(alice.user, 'house.rename', { name: 'Suspendus' }),
    ])
      expect(codeOf(reply)).toEqual([409, 'SUSPENDED']);
    const [suspension] = await rows(
      sql<{ id: string }>`select id from admin.sanctions where user_id = ${alice.user}`,
    );
    const appeal = { sanctionId: suspension?.id, body: 'Je conteste.' };
    expect((await send(alice.user, 'moderation.appeal', appeal)).status).toBe(200);
    expect((await post(bob.user, world.kallisteChannel, 'Bob, libre.')).status).toBe(200);
  });

  it('une suspension ne refuse pas une commande d’administration à un compte qui porte son rôle', async () => {
    const world = await newWorld();
    const alice = await world.player();
    await sql`insert into admin.roles (user_id, role, granted_by)
      values (${alice.user}, 'game_designer', ${await moderator()})`.execute(owner);
    try {
      await sanction(alice.user, 'suspension', 0, 3600);
      expect(codeOf(await post(alice.user, world.kallisteChannel, 'Bonjour'))).toEqual([
        409,
        'SUSPENDED',
      ]);
      // Une configuration refusée par le schéma : la commande s'exécute, sans rien enregistrer.
      const admin = await send(`aal2:${alice.user}`, 'admin.publishConfig', {
        config: {},
        note: 'x',
      });
      expect(codeOf(admin)).toEqual([409, 'CONFIG_INVALID']);
    } finally {
      await sql`delete from admin.roles where user_id = ${alice.user}`.execute(owner);
    }
  });

  it('une exclusion n’agit qu’une fois validée ; un avertissement, une sanction finie ou à venir ne bloquent rien', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    await sanction(alice.user, 'ban', 0, null);
    await sanction(alice.user, 'warning', 0, 3600);
    await sanction(alice.user, 'suspension', -7200, -3600);
    await sanction(alice.user, 'suspension', 3600, 7200);
    expect((await post(alice.user, world.kallisteChannel, 'Toujours là.')).status).toBe(200);
    await sanction(bob.user, 'ban', -10, null, await moderator());
    expect(codeOf(await post(bob.user, world.kallisteChannel, 'Banni ?'))).toEqual([
      409,
      'SUSPENDED',
    ]);
  });

  it('une suspension prononcée entre deux commandes refuse la seconde ; un rejeu rend la réponse déjà validée', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const key = randomUUID();
    const first = await send(
      alice.user,
      'chat.post',
      { channelId: world.kallisteChannel, body: 'Un' },
      { key },
    );
    expect(first.status).toBe(200);
    await sanction(alice.user, 'suspension', -1, 3600);
    const replay = await send(
      alice.user,
      'chat.post',
      { channelId: world.kallisteChannel, body: 'Un' },
      { key },
    );
    expect([replay.status, replay.replayed, replay.body]).toEqual([200, 'true', first.body]);
    expect(codeOf(await post(alice.user, world.kallisteChannel, 'Deux'))).toEqual([
      409,
      'SUSPENDED',
    ]);
  });
});

describe('filtre de vocabulaire', () => {
  const filtered = appWith(async () => ({
    ...TEST_CONFIG,
    config: {
      ...TEST_CONFIG.config,
      moderation: { ...TEST_CONFIG.config.moderation, bannedTerms: ['Maudit', 'fils de chien'] },
    },
  }));

  it('refuse un message qui contient un terme interdit, sans casse ni accent, avant tout enregistrement', async () => {
    const world = await newWorld();
    const alice = await world.player();
    for (const body of ['Tu es MÂUDIT !', 'Fils-de-chien.'])
      expect(
        codeOf(
          await send(
            alice.user,
            'chat.post',
            { channelId: world.kallisteChannel, body },
            { via: filtered },
          ),
        ),
      ).toEqual([409, 'MESSAGE_REJECTED']);
    expect(
      await rows(
        sql`select count(*)::int as n from game.messages where house_id = ${alice.houseId}`,
      ),
    ).toEqual([{ n: 0 }]);
    const kept = await send(
      alice.user,
      'chat.post',
      { channelId: world.kallisteChannel, body: 'Ces maudits vents !' },
      { via: filtered },
    );
    expect(kept.status).toBe(200);
    // Le journal ne garde ni le texte ni le terme : l'entrée y est réduite à sa taille et son empreinte.
    const [refused] = await rows(sql<{ input: unknown; response: unknown }>`
      select input, response from game.command_log
      where user_id = ${alice.user} and error_code = 'MESSAGE_REJECTED' limit 1`);
    expect(JSON.stringify(refused)).not.toMatch(/maudit|chien/i);
  });
});

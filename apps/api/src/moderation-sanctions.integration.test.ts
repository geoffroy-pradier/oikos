import { randomUUID } from 'node:crypto';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appWith,
  codeOf,
  db,
  newWorld,
  openDirect,
  owner,
  rows,
  send,
  type Reply,
} from './chat-test-world';
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

/**
 * Envoie une commande et la laisse lire son horloge puis attendre le verrou de sa clé, tenu ici (#611) : `during`
 * reçoit l'instant exact de sa transaction (`now()`, à la microseconde, lu dans `pg_stat_activity`) et écrit dans
 * la transaction du verrou, validée avant que la commande ne reprenne. Rend la réponse de la première commande dont
 * `during` a gardé l'instant : il écarte (faux, sans écrire) un instant qu'une `Date` à la milliseconde représente
 * sans perte, qui ne départage rien ; la commande suivante a une autre clé, donc un autre instant.
 */
async function atCommandInstant(
  user: string,
  command: string,
  body: () => unknown,
  during: (trx: Db, at: string) => Promise<boolean>,
): Promise<Reply> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const key = randomUUID();
    let reply: Promise<Reply> | undefined;
    const wrote = await owner.transaction().execute(async (trx) => {
      const { rows: held } = await sql<{ pid: number }>`select pg_backend_pid() as pid,
        pg_advisory_xact_lock(hashtextextended(${`${user}:${key}`}, 0))`.execute(trx);
      reply = send(user, command, body(), { key });
      for (;;) {
        const [waiting] = await rows(sql<{ at: string }>`select xact_start::text as at
          from pg_stat_activity where ${held[0]?.pid}::int = any(pg_blocking_pids(pid))`);
        if (waiting) return during(trx, waiting.at);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    });
    if (!reply) throw new Error('The command was not sent');
    if (wrote) return reply;
    await reply;
  }
  throw new Error('No sub-millisecond command instant in five attempts');
}

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

  it('une suspension qui commence à l’instant même de la commande, dans sa milliseconde, la refuse (#611)', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const author = await moderator();
    const reply = await atCommandInstant(
      alice.user,
      'chat.post',
      () => ({ channelId: world.kallisteChannel, body: 'À l’instant ?' }),
      async (trx, at) => {
        const { numAffectedRows } = await sql`insert into admin.sanctions
            (user_id, kind, starts_at, ends_at, reason, author_id)
          select ${alice.user}, 'suspension', t, t + interval '1 hour', 'Essai', ${author}
          from (select ${at}::timestamptz as t) i where date_trunc('milliseconds', t) <> t`.execute(
          trx,
        );
        return numAffectedRows === 1n;
      },
    );
    expect(codeOf(reply)).toEqual([409, 'SUSPENDED']);
  });

  it('une sanction qui finit une microseconde après l’instant de la commande peut encore être contestée (#611)', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const author = await moderator();
    let sanctionId = '';
    const reply = await atCommandInstant(
      alice.user,
      'moderation.appeal',
      () => ({ sanctionId: (sanctionId = randomUUID()), body: 'Je conteste.' }),
      async (trx, at) => {
        const { numAffectedRows } = await sql`insert into admin.sanctions
            (id, user_id, kind, starts_at, ends_at, reason, author_id)
          select ${sanctionId}, ${alice.user}, 'silence', t - interval '1 hour', e, 'Essai', ${author}
          from (select ${at}::timestamptz as t, ${at}::timestamptz + interval '1 microsecond' as e) i
          where date_trunc('milliseconds', e) = date_trunc('milliseconds', t)`.execute(trx);
        return numAffectedRows === 1n;
      },
    );
    expect(reply.status).toBe(200);
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

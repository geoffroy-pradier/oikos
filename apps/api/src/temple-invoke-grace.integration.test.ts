import { randomUUID } from 'node:crypto';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { db, eventsOf, KALLISTE, newPlayer, owner, send } from './property.integration-fixtures';
import { blessed, graceApp, TEST_GRACES } from './grace.integration-fixtures';
import { TEST_CONFIG } from './test-config';
import type { App } from './voyage.integration-fixtures';

// Invocation d'une grâce, contre Supabase local, avec les grâces d'essai (`TEST_GRACES`) : la récolte bénie de
// Déméter demande 300 de Charis, en dépense 150 et se recharge en trois jours. La Charis vient d'offrandes de monnaie
// (1 Charis par obole). Chaque test fonde sa maison à Kallistè.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const HARVEST = TEST_GRACES.find((grace) => grace.id === 'demeter_harvest');
if (!HARVEST) throw new Error('demeter_harvest expected');
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;
const invoke = (
  user: string,
  spent = 150,
  key?: string,
  via: App = blessed,
  graceId = 'demeter_harvest',
) => send(user, 'temple.invokeGrace', { graceId, expectedCharisSpent: spent }, key, via);
const offer = (user: string, oboles: number) =>
  send(user, 'temple.makeOffering', {
    godId: 'demeter',
    oboles,
    goods: [],
    expectedCharis: oboles,
  });
const charisOf = async (houseId: string) =>
  Number(
    (
      await sql<{ charis: string }>`select charis from game.favor
        where house_id = ${houseId} and god_id = 'demeter'`.execute(db)
    ).rows[0]?.charis ?? 0,
  );
const usesOf = (houseId: string) =>
  db
    .selectFrom('game.graces_used')
    .select(['id', 'grace_id', 'effect', 'magnitude_bps', 'charis_spent', 'consumed_at'])
    .where('house_id', '=', houseId)
    .execute();
/** Une maison de Kallistè qui a offert `oboles` à Déméter. */
async function devout(oboles: number) {
  const player = await newPlayer(KALLISTE);
  expect((await offer(player.user, oboles)).status).toBe(200);
  return player;
}
/** Rien n'a bougé : ni Charis, ni invocation, ni événement. */
async function untouched(houseId: string, charis: number) {
  expect(await charisOf(houseId)).toBe(charis);
  expect(await usesOf(houseId)).toEqual([]);
  expect(await eventsOf(houseId, 'GraceInvoked')).toEqual([]);
}

describe('temple.invokeGrace (#266)', () => {
  it('Charis dépensée au journal, invocation en attente, GraceInvoked ; rejouable', async () => {
    const player = await devout(300);
    const key = randomUUID();
    const done = await invoke(player.user, 150, key);
    expect(done.status).toBe(200);
    const { data } = done.body;
    const clock = TEST_CONFIG.config.clock;
    const { rows } = await sql<{ invoked_at: Date }>`select invoked_at from game.graces_used
      where id = ${data.graceUseId as string}`.execute(db);
    const readyAt = dailyCloseAt(gameDayAt(rows[0]?.invoked_at ?? new Date(0), clock) + 3, clock);
    expect(data).toEqual({
      graceUseId: expect.any(String),
      graceId: 'demeter_harvest',
      godId: 'demeter',
      effect: 'blessed_harvest',
      magnitudeBps: HARVEST.magnitudeBps,
      charisSpent: 150,
      readyAt: readyAt.toISOString(),
      charis: 150,
    });
    expect(await charisOf(player.houseId)).toBe(150);
    expect(await usesOf(player.houseId)).toEqual([
      {
        id: data.graceUseId,
        grace_id: 'demeter_harvest',
        effect: 'blessed_harvest',
        magnitude_bps: HARVEST.magnitudeBps,
        charis_spent: '150',
        consumed_at: null,
      },
    ]);
    const ledger = await sql`select kind, amount from game.favor_ledger
      where grace_use_id = ${data.graceUseId as string}`.execute(db);
    expect(ledger.rows).toEqual([{ kind: 'grace', amount: '-150' }]);
    const invocation = { ...data, houseId: player.houseId };
    delete invocation.charis;
    expect(await eventsOf(player.houseId, 'GraceInvoked')).toEqual([invocation]);
    // Rejeu de la même clé : même réponse, rien de plus dépensé.
    expect(await invoke(player.user, 150, key)).toEqual(done);
    expect([await charisOf(player.houseId), (await usesOf(player.houseId)).length]).toEqual([
      150, 1,
    ]);
    // En attente, elle ne s'invoque pas une seconde fois, même avec la Charis requise.
    expect((await offer(player.user, 300)).status).toBe(200);
    expect(codeOf(await invoke(player.user))).toBe('GRACE_PENDING');
    expect([await charisOf(player.houseId), (await usesOf(player.houseId)).length]).toEqual([
      450, 1,
    ]);
  });

  it('Charis insuffisante : 299 ne suffisent pas, 300 oui (la Charis requise, pas la dépensée)', async () => {
    const player = await devout(299);
    expect(await invoke(player.user)).toMatchObject({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_CHARIS' } },
    });
    await untouched(player.houseId, 299);
    // Sans aucune Charis envers ce dieu, même refus.
    const atheist = await newPlayer(KALLISTE);
    expect(codeOf(await invoke(atheist.user))).toBe('INSUFFICIENT_CHARIS');
    await untouched(atheist.houseId, 0);
    expect((await offer(player.user, 1)).status).toBe(200);
    expect((await invoke(player.user)).body.data).toMatchObject({ charis: 150 });
  });

  it('refus sans effet : grâce inconnue, Charis dépensée changée entre l’affichage et le clic', async () => {
    const player = await devout(1_000);
    expect(codeOf(await invoke(player.user, 150, undefined, undefined, 'zeus_bolt'))).toBe(
      'GRACE_NOT_FOUND',
    );
    expect(codeOf(await invoke(player.user, 149))).toBe('CHARIS_CHANGED');
    const dearer = graceApp((grace) => ({ ...grace, charisSpent: 200 }));
    expect(codeOf(await invoke(player.user, 150, undefined, dearer))).toBe('CHARIS_CHANGED');
    await untouched(player.houseId, 1_000);
    // Une grâce gratuite n'écrit aucune ligne de Charis.
    const free = graceApp((grace) => ({ ...grace, charisSpent: 0 }));
    expect((await invoke(player.user, 0, undefined, free)).body.data).toMatchObject({
      charis: 1_000,
    });
    const ledger =
      await sql`select 1 from game.favor_ledger f join game.graces_used g on g.id = f.grace_use_id
      where g.house_id = ${player.houseId}`.execute(db);
    expect([ledger.rows.length, await charisOf(player.houseId)]).toEqual([0, 1_000]);
  });

  it('deux invocations à la fois, sous deux clés : une seule passe, une seule Charis dépensée', async () => {
    const player = await devout(1_000);
    const replies = await Promise.all([invoke(player.user), invoke(player.user)]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect(replies.map(codeOf).filter(Boolean)).toEqual(['GRACE_PENDING']);
    expect([await charisOf(player.houseId), (await usesOf(player.houseId)).length]).toEqual([
      850, 1,
    ]);
    expect(await eventsOf(player.houseId, 'GraceInvoked')).toHaveLength(1);
  });
});

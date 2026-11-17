import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  db,
  eventsOf,
  give,
  KALLISTE,
  newPlayer,
  owner,
  send,
} from './property.integration-fixtures';
import { blessed, graceApp } from './grace.integration-fixtures';
import { stockOf, type App } from './voyage.integration-fixtures';

// Récolte bénie et atelier inspiré consommés par `site.collect` (#266), contre Supabase local. Les grâces d'essai
// (`TEST_GRACES` : 20 %, 300 de Charis requise, 150 dépensée, trois jours de recharge) sont invoquées sous une
// version qui les offre ; les récoltes sont servies par la configuration initiale, qui n'en a aucune : ce qui a été
// payé est servi. Champ de blé de départ : 40 blés par cycle de 4 h ; moulin : 10 blés pour 8 farines par heure.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;
const offer = (user: string, godId: string, oboles: number) =>
  send(user, 'temple.makeOffering', { godId, oboles, goods: [], expectedCharis: oboles });
const invoke = (user: string, graceId = 'demeter_harvest', via: App = blessed) =>
  send(user, 'temple.invokeGrace', { graceId, expectedCharisSpent: 150 }, undefined, via);
const collect = (user: string, siteId: string) => send(user, 'site.collect', { siteId });
const acquire = async (user: string, recipeId: string) =>
  (await send(user, 'site.acquire', { recipeId })).body.data.siteId as string;
const fieldOf = async (houseId: string) =>
  (
    await db
      .selectFrom('game.sites')
      .select('id')
      .where('house_id', '=', houseId)
      .orderBy('created_at')
      .executeTakeFirstOrThrow()
  ).id;
/** Fait vieillir le cycle en cours : la garde de la base interdit l'antidatage, levée le temps du test. */
async function age(siteId: string, minutes: number) {
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = created_at - ${`${minutes} minutes`}::interval,
      cycle_started_at = cycle_started_at - ${`${minutes} minutes`}::interval where id = ${siteId}`.execute(
      trx,
    );
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
}
const usesOf = async (houseId: string) =>
  (
    await sql<{ grace_id: string; site_id: string | null; surplus: string | null }>`
      select g.grace_id, g.site_id, (select string_agg(s.good_id || ':' || s.quantity || ':' || s.from_system
        || ':' || s.kind, ' ') from game.stock_ledger s where s.grace_use_id = g.id) as surplus
      from game.graces_used g where g.house_id = ${houseId} order by g.invoked_at`.execute(db)
  ).rows;

describe('grâces consommées par une récolte (#266)', () => {
  it('récolte bénie : surplus venu de `production`, une seule fois, puis recharge', async () => {
    const player = await newPlayer(KALLISTE);
    const field = await fieldOf(player.houseId);
    expect((await offer(player.user, 'demeter', 300)).status).toBe(200);
    const invoked = await invoke(player.user);
    await age(field, 2 * 240 + 5);
    const blessed = await collect(player.user, field);
    expect(blessed.body.data).toMatchObject({
      cycles: 2,
      outputs: [{ goodId: 'wheat', quantity: 80 }],
      grace: {
        graceUseId: invoked.body.data.graceUseId,
        graceId: 'demeter_harvest',
        effect: 'blessed_harvest',
        surplus: [{ goodId: 'wheat', quantity: 16 }],
      },
    });
    expect(await stockOf(player.houseId, 'wheat')).toBe(96);
    expect(await usesOf(player.houseId)).toEqual([
      { grace_id: 'demeter_harvest', site_id: field, surplus: 'wheat:16:production:grace.surplus' },
    ]);
    expect((await eventsOf(player.houseId, 'SiteCollected'))[0]).toMatchObject({
      grace: blessed.body.data.grace,
    });
    // La récolte suivante ne la consomme pas une seconde fois.
    await age(field, 240);
    const plain = await collect(player.user, field);
    expect(plain.body.data.outputs).toEqual([{ goodId: 'wheat', quantity: 40 }]);
    expect(plain.body.data.grace).toBeUndefined();
    expect(await stockOf(player.houseId, 'wheat')).toBe(136);
    // Consommée, elle se recharge : refus, sans rien dépenser.
    expect((await offer(player.user, 'demeter', 300)).status).toBe(200);
    const again = await invoke(player.user);
    expect(codeOf(again)).toBe('GRACE_RECHARGING');
    expect(again.body.error?.message).toContain(invoked.body.data.readyAt as string);
    expect(await usesOf(player.houseId)).toHaveLength(1);
  });

  it('deux récoltes concurrentes de deux sites, une grâce en attente : une seule la consomme', async () => {
    const player = await newPlayer(KALLISTE);
    const field = await fieldOf(player.houseId);
    // Un verger : d'autres stocks que le champ, si bien que seules les grâces font se suivre les deux récoltes.
    const orchard = await acquire(player.user, 'grow_olives');
    expect((await offer(player.user, 'demeter', 300)).status).toBe(200);
    expect((await invoke(player.user)).status).toBe(200);
    await age(field, 245);
    await age(orchard, 365);
    const replies = await Promise.all([collect(player.user, field), collect(player.user, orchard)]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    const blessed = replies.filter((reply) => reply.body.data.grace !== undefined);
    expect(blessed).toHaveLength(1);
    const uses = await usesOf(player.houseId);
    expect(uses).toHaveLength(1);
    expect([field, orchard]).toContain(uses[0]?.site_id);
    expect(uses[0]?.surplus?.split(' ')).toHaveLength(1);
    // Le surplus est celui du site qui l'a consommée : 20 % de 40 blés, ou de 24 olives.
    expect(uses[0]?.surplus).toBe(
      uses[0]?.site_id === field
        ? 'wheat:8:production:grace.surplus'
        : 'olives:4:production:grace.surplus',
    );
  });

  it('atelier inspiré : seulement par un atelier, sans intrant de plus ; la récolte bénie attend un champ', async () => {
    const player = await newPlayer(KALLISTE);
    const field = await fieldOf(player.houseId);
    const mill = await acquire(player.user, 'mill_flour');
    await give(player.houseId, 'wheat', 20);
    expect((await offer(player.user, 'demeter', 300)).status).toBe(200);
    expect((await offer(player.user, 'athena', 300)).status).toBe(200);
    expect((await invoke(player.user)).status).toBe(200);
    expect((await invoke(player.user, 'athena_inspiration')).status).toBe(200);
    await age(mill, 125);
    const milled = await collect(player.user, mill);
    // Deux cycles : 20 blés pour 16 farines, plus ⌊16 × 20 %⌋ = 3 farines, sans blé de plus.
    expect(milled.body.data).toMatchObject({
      inputs: [{ goodId: 'wheat', quantity: 20 }],
      outputs: [{ goodId: 'flour', quantity: 16 }],
      grace: { graceId: 'athena_inspiration', surplus: [{ goodId: 'flour', quantity: 3 }] },
    });
    expect([
      await stockOf(player.houseId, 'wheat'),
      await stockOf(player.houseId, 'flour'),
    ]).toEqual([0, 19]);
    expect((await usesOf(player.houseId)).map((use) => use.site_id)).toEqual([null, mill]);
    await age(field, 245);
    expect((await collect(player.user, field)).body.data.grace).toMatchObject({
      graceId: 'demeter_harvest',
    });
  });

  it('une grâce dont le surplus serait nul n’est pas consommée : elle attend une récolte plus grande', async () => {
    const player = await newPlayer(KALLISTE);
    const field = await fieldOf(player.houseId);
    expect((await offer(player.user, 'demeter', 300)).status).toBe(200);
    // Invoquée sous une version où l'ampleur est de 1 point de base : 40 blés ne rendent rien de plus.
    const faint = graceApp((grace) => ({ ...grace, magnitudeBps: 1 }));
    expect((await invoke(player.user, 'demeter_harvest', faint)).status).toBe(200);
    await age(field, 245);
    const reply = await collect(player.user, field);
    expect([reply.status, reply.body.data.grace]).toEqual([200, undefined]);
    expect(await usesOf(player.houseId)).toEqual([
      { grace_id: 'demeter_harvest', site_id: null, surplus: null },
    ]);
    expect(await stockOf(player.houseId, 'wheat')).toBe(40);
  });
});

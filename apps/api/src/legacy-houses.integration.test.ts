import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { codeOf, db, newWorld, owner, rows, send } from './chat-test-world';

// Compte hérité d'avant #604 avec une maison dans deux mondes, contre Supabase local : posé en contournant le
// déclencheur, comme la base d'avant la migration 600. Toute commande agit par sa plus ancienne maison (création, puis
// identifiant), jamais par une maison choisie au hasard.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const name = () => `Nom ${[...randomUUID().replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;

describe('compte hérité à deux maisons (#604)', () => {
  it('agit par sa plus ancienne maison, création puis identifiant ; n’en fonde pas une troisième', async () => {
    const [here, there] = [await newWorld(), await newWorld()];
    const alice = await here.player();
    const second = await there.player(there.kalliste, true);
    // La maison de l'autre monde passe à Alice et devient la plus ancienne, bien que son identifiant soit plus grand.
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.houses disable trigger houses_one_per_account`.execute(trx);
      await sql`update game.houses set user_id = ${alice.user},
        created_at = (select created_at - interval '1 hour' from game.houses where id = ${alice.houseId})
        where id = ${second.houseId}`.execute(trx);
      await sql`alter table game.houses enable trigger houses_one_per_account`.execute(trx);
    });
    expect(second.houseId > alice.houseId).toBe(true);

    const renamed = await send(alice.user, 'house.rename', { name: name() });
    expect(renamed.body.data).toMatchObject({ houseId: second.houseId });
    // Opération partagée avec le moteur (`houseOf` de @oikos/operations).
    const order = await send(alice.user, 'market.placeOrder', {
      cityId: there.kalliste,
      goodId: 'wheat',
      side: 'buy',
      price: 1,
      quantity: 1,
    });
    expect(order.status).toBe(200);
    expect(
      await rows(
        sql`select house_id from game.orders where id = ${order.body.data.orderId as string}`,
      ),
    ).toEqual([{ house_id: second.houseId }]);
    // La discussion : le canal de la plus ancienne s'ouvre, celui de l'autre maison non.
    expect(
      (await send(alice.user, 'chat.post', { channelId: there.kallisteChannel, body: 'Ici' }))
        .status,
    ).toBe(200);
    expect(
      codeOf(await send(alice.user, 'chat.post', { channelId: here.kallisteChannel, body: 'Là' })),
    ).toEqual([404, 'CHANNEL_NOT_FOUND']);

    // À création égale, le plus petit identifiant l'emporte.
    await sql`update game.houses set created_at = (select created_at from game.houses where id = ${second.houseId})
      where id = ${alice.houseId}`.execute(owner);
    expect((await send(alice.user, 'house.rename', { name: name() })).body.data).toMatchObject({
      houseId: alice.houseId,
    });

    const founded = await send(alice.user, 'house.create', {
      cityId: there.elaia,
      name: name(),
      blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
    });
    expect(codeOf(founded)).toEqual([409, 'HOUSE_ALREADY_EXISTS']);
    expect(
      await rows(sql`select count(*)::int as n from game.houses where user_id = ${alice.user}`),
    ).toEqual([{ n: 2 }]);
  });
});

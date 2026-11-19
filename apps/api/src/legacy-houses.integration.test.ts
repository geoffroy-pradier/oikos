import { randomUUID } from 'node:crypto';
import { accountHouseId } from '@oikos/operations';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { codeOf, db, newWorld, owner, rows, send } from './chat-test-world';

// Compte hérité d'avant #604 avec une maison dans deux mondes, contre Supabase local : posé en contournant le
// déclencheur, comme la base d'avant la migration 750. Toute commande agit par sa plus ancienne maison (création, puis
// identifiant), jamais par une maison choisie au hasard.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const name = () => `Nom ${[...randomUUID().replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;

describe('compte hérité à deux maisons (#604)', () => {
  it('agit par sa plus ancienne maison, création puis identifiant ; n’en fonde pas une troisième', async () => {
    const [here, there] = [await newWorld(), await newWorld()];
    const alice = await here.player();
    const second = await there.player(there.kalliste, true);
    // La maison de l'autre monde, fondée après, passe à Alice et devient la plus ancienne.
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.houses disable trigger houses_one_per_account`.execute(trx);
      await sql`update game.houses set user_id = ${alice.user},
        created_at = (select created_at - interval '1 hour' from game.houses where id = ${alice.houseId})
        where id = ${second.houseId}`.execute(trx);
      await sql`alter table game.houses enable trigger houses_one_per_account`.execute(trx);
    });

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

    // À création égale, le plus petit identifiant l'emporte, quel que soit l'ordre de fondation.
    await sql`update game.houses set created_at = (select created_at from game.houses where id = ${second.houseId})
      where id = ${alice.houseId}`.execute(owner);
    const smallest = [alice.houseId, second.houseId].sort()[0];
    expect((await send(alice.user, 'house.rename', { name: name() })).body.data).toMatchObject({
      houseId: smallest,
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

  it('accountHouseId : la plus ancienne par création, puis le plus petit identifiant, sans index ni ordre d’insertion', async () => {
    const prefix = randomUUID().slice(0, 24);
    const id = (n: number) => `${prefix}${String(n).padStart(12, '0')}`;
    const user = randomUUID();
    const pick = owner.transaction().execute(async (trx) => {
      // Ni parcours d'index, ni ordre des lignes : seul le tri de la sous-requête décide.
      await sql`set local enable_indexscan = off; set local enable_indexonlyscan = off;
        set local enable_bitmapscan = off`.execute(trx);
      await sql`alter table game.houses disable trigger houses_one_per_account`.execute(trx);
      await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
        trx,
      );
      // Insérées dans le désordre : la première insérée a le plus petit identifiant mais est la plus récente ; les deux
      // suivantes ont la même date, et la dernière insérée a le plus petit identifiant des deux.
      for (const [n, age] of [
        [1, '0 hours'],
        [3, '2 hours'],
        [2, '2 hours'],
      ] as const) {
        const world = randomUUID();
        await sql`insert into game.worlds (id, slug, name) values (${world}, ${`a-${world.slice(0, 12)}`}, 'Test')`.execute(
          trx,
        );
        await sql`insert into game.houses (id, world_id, user_id, name, blazon, created_at)
          values (${id(n)}, ${world}, ${user}, ${`Maison ${'abc'[n - 1]}`}, '{}', now() - ${age}::interval)`.execute(
          trx,
        );
      }
      const oldest = async () =>
        (await sql<{ id: string }>`select ${accountHouseId(user)} as id`.execute(trx)).rows[0]?.id;
      const picked = [await oldest()];
      // Rajeunie, la gagnante cède la place à la suivante.
      await sql`update game.houses set created_at = now() where id = ${id(2)}`.execute(trx);
      picked.push(await oldest());
      throw Object.assign(new Error('rollback'), { picked });
    });
    await expect(pick).rejects.toMatchObject({ picked: [id(2), id(3)] });
  });
});

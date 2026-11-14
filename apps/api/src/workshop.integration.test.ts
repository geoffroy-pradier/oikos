import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';

// Ateliers (recettes à intrants) récoltés par `site.collect`, contre Supabase local.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const app = createApp({
  db,
  telemetry: createTelemetry(db),
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
// Ventes déposées par ces tests, annulées à la fin : la cité est partagée avec d'autres suites, dont le
// carnet d'ordres ne doit pas garder nos ventes.
const placed: { user: string; orderId: string }[] = [];
afterAll(async () => {
  for (const { user, orderId } of placed) await send(user, 'market.cancelOrder', { orderId });
  await Promise.all([db.destroy(), owner.destroy()]);
});

const recipe = (id: string) => {
  const found = TEST_CONFIG.config.recipes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`recipe ${id} missing from the test configuration`);
  return found;
};
const [FIELD, MILL, BAKERY] = [recipe('grow_wheat'), recipe('mill_flour'), recipe('bake_bread')];
const per = (source: typeof MILL, side: 'inputs' | 'outputs', goodId: string) => {
  const stack = source[side].find((candidate) => candidate.goodId === goodId);
  if (!stack) throw new Error(`${source.id} has no ${goodId} in its ${side}`);
  return stack.quantity;
};
const WHEAT_PER_FIELD = per(FIELD, 'outputs', 'wheat');
const WHEAT_PER_FLOUR = per(MILL, 'inputs', 'wheat');
const FLOUR = per(MILL, 'outputs', 'flour');
const FLOUR_PER_BREAD = per(BAKERY, 'inputs', 'flour');
const CHARCOAL_PER_BREAD = per(BAKERY, 'inputs', 'charcoal');
const BREAD = per(BAKERY, 'outputs', 'bread');
const CITY = '01900000-0000-7000-8000-000000000101';
const WORLD = '01900000-0000-7000-8000-000000000001';
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');

interface Reply {
  status: number;
  // Les formes exactes sont vérifiées champ par champ dans les tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok: boolean; data?: any; error?: { code: string } };
}
const send = async (
  user: string,
  command: string,
  body: unknown,
  key: string = randomUUID(),
): Promise<Reply> => {
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
};
const collect = (user: string, siteId: string, key?: string) =>
  send(user, 'site.collect', { siteId }, key);

/** Fonde une maison (un champ de blé) et lui acquiert les ateliers demandés. */
async function newPlayer(...workshops: string[]) {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  const founded = await send(user, 'house.create', {
    cityId: CITY,
    name: `Atelier ${letters()}`,
    blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
  });
  const houseId = founded.body.data.houseId as string;
  const field = await db
    .selectFrom('game.sites')
    .select('id')
    .where('house_id', '=', houseId)
    .executeTakeFirstOrThrow();
  const sites: string[] = [];
  for (const recipeId of workshops) {
    const bought = await send(user, 'site.acquire', { recipeId });
    if (bought.status !== 200) throw new Error(`cannot acquire ${recipeId}`);
    sites.push(bought.body.data.siteId as string);
  }
  return { user, houseId, field: field.id, sites };
}
/** Fait vieillir le cycle en cours : la garde de la base interdit l'antidatage, levée ici le temps du test. */
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
/** Met un bien en stock par le journal, comme le ferait une livraison. */
async function give(houseId: string, goodId: string, quantity: number) {
  const place = { world_id: WORLD, house_id: houseId, city_id: CITY, good_id: goodId };
  await owner
    .insertInto('game.inventories')
    .values(place)
    .onConflict((conflict) => conflict.constraint('inventories_unique').doNothing())
    .execute();
  const inventory = await owner
    .selectFrom('game.inventories')
    .select('id')
    .where('house_id', '=', houseId)
    .where('good_id', '=', goodId)
    .executeTakeFirstOrThrow();
  await owner
    .insertInto('game.stock_ledger')
    .values({
      world_id: WORLD,
      good_id: goodId,
      quantity,
      from_system: 'test',
      to_inventory_id: inventory.id,
      kind: 'test',
    })
    .execute();
}
/** Stock de la maison : quantité, et part réservée par des ventes quand il y en a (« quantité/réservé »). */
const stockOf = async (houseId: string) =>
  Object.fromEntries(
    (
      await db
        .selectFrom('game.inventories')
        .select(['good_id', 'quantity', 'reserved'])
        .where('house_id', '=', houseId)
        .execute()
    ).map((row) => [
      row.good_id,
      Number(row.reserved) > 0 ? `${row.quantity}/${row.reserved}` : Number(row.quantity),
    ]),
  );
async function sell(user: string, goodId: string, quantity: number) {
  const order = { cityId: CITY, goodId, side: 'sell', price: 900, quantity };
  const reply = await send(user, 'market.placeOrder', order);
  if (reply.status === 200) placed.push({ user, orderId: reply.body.data.orderId as string });
  return reply;
}

describe('site.collect sur un atelier', () => {
  it('du blé au pain : chaque atelier consomme ses intrants et livre ses extrants par le journal', async () => {
    const player = await newPlayer('mill_flour', 'bake_bread');
    const [mill, bakery] = player.sites as [string, string];
    await age(player.field, 2 * FIELD.durationMinutes);
    expect((await collect(player.user, player.field)).body.data).toMatchObject({
      cycles: 2,
      inputs: [],
    });
    const wheat = 2 * WHEAT_PER_FIELD;

    // Trois cycles de mouture.
    await age(mill, 3 * MILL.durationMinutes);
    expect(await collect(player.user, mill)).toMatchObject({
      status: 200,
      body: {
        data: {
          cycles: 3,
          inputs: [{ goodId: 'wheat', quantity: 3 * WHEAT_PER_FLOUR }],
          outputs: [{ goodId: 'flour', quantity: 3 * FLOUR }],
        },
      },
    });
    expect(await stockOf(player.houseId)).toEqual({
      wheat: wheat - 3 * WHEAT_PER_FLOUR,
      flour: 3 * FLOUR,
    });
    const movements = await sql<{ good_id: string; quantity: string; way: string }>`
      select m.good_id, m.quantity,
        case when m.to_system = 'production' then 'out' when m.from_system = 'production' then 'in' end as way
      from game.stock_ledger m
      join game.inventories i on i.id = coalesce(m.from_inventory_id, m.to_inventory_id)
      where i.house_id = ${player.houseId} and m.kind = 'site.collect' and i.good_id in ('wheat', 'flour')
        and (m.to_system = 'production' or i.good_id = 'flour')
      order by way desc`.execute(owner);
    expect(movements.rows).toEqual([
      { good_id: 'wheat', quantity: String(3 * WHEAT_PER_FLOUR), way: 'out' },
      { good_id: 'flour', quantity: String(3 * FLOUR), way: 'in' },
    ]);

    // Le four : cinq cycles écoulés, de la farine pour quatre, du charbon pour deux. Le plus rare décide.
    expect(Math.floor((3 * FLOUR) / FLOUR_PER_BREAD)).toBe(4);
    await give(player.houseId, 'charcoal', 2 * CHARCOAL_PER_BREAD);
    await age(bakery, 5 * BAKERY.durationMinutes);
    expect((await collect(player.user, bakery)).body.data).toMatchObject({
      cycles: 2,
      inputs: [
        { goodId: 'charcoal', quantity: 2 * CHARCOAL_PER_BREAD },
        { goodId: 'flour', quantity: 2 * FLOUR_PER_BREAD },
      ],
      outputs: [{ goodId: 'bread', quantity: 2 * BREAD }],
    });
    // À court de charbon : trois cycles attendent, rien ne bouge.
    const waiting = {
      wheat: wheat - 3 * WHEAT_PER_FLOUR,
      flour: 3 * FLOUR - 2 * FLOUR_PER_BREAD,
      charcoal: 0,
      bread: 2 * BREAD,
    };
    expect(await collect(player.user, bakery)).toMatchObject({
      status: 409,
      body: { error: { code: 'MISSING_INPUTS' } },
    });
    expect(await stockOf(player.houseId)).toEqual(waiting);
    // Réapprovisionné : les cycles dus tournent aussitôt, dans la limite de la farine restante (deux).
    await give(player.houseId, 'charcoal', 5 * CHARCOAL_PER_BREAD);
    expect((await collect(player.user, bakery)).body.data).toMatchObject({ cycles: 2 });
    expect(await stockOf(player.houseId)).toEqual({
      ...waiting,
      flour: 3 * FLOUR - 4 * FLOUR_PER_BREAD,
      charcoal: 3 * CHARCOAL_PER_BREAD,
      bread: 4 * BREAD,
    });
    const events = await db
      .selectFrom('game.domain_events')
      .select('payload')
      .where(sql<boolean>`payload->>'siteId' = ${bakery}`)
      .where('type', '=', 'SiteCollected')
      .execute();
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toMatchObject({ cycles: 2, inputs: [{}, {}], outputs: [{}] });
  });

  it('rien avant la fin du premier cycle, même les intrants en stock ; puis rejeu sans seconde consommation', async () => {
    const player = await newPlayer('mill_flour');
    const [mill] = player.sites as [string];
    await give(player.houseId, 'wheat', 100);
    await age(mill, MILL.durationMinutes - 1);
    expect((await collect(player.user, mill)).body.error?.code).toBe('NOTHING_TO_COLLECT');
    await age(mill, 1);
    const key = randomUUID();
    const first = await collect(player.user, mill, key);
    expect(first.body.data).toMatchObject({ cycles: 1 });
    expect(await collect(player.user, mill, key)).toEqual(first);
    expect(await stockOf(player.houseId)).toEqual({ wheat: 100 - WHEAT_PER_FLOUR, flour: FLOUR });
  });

  it('le stock réservé par une vente n’est pas consommé', async () => {
    const player = await newPlayer('mill_flour');
    const [mill] = player.sites as [string];
    await give(player.houseId, 'wheat', 80);
    expect((await sell(player.user, 'wheat', 75)).status).toBe(200);
    await age(mill, 2 * MILL.durationMinutes);
    // 5 unités libres : pas de quoi moudre une fois.
    expect((await collect(player.user, mill)).body.error?.code).toBe('MISSING_INPUTS');
    expect(await stockOf(player.houseId)).toEqual({ wheat: '80/75' });
    // 10 de plus : un cycle sur les deux écoulés.
    await give(player.houseId, 'wheat', WHEAT_PER_FLOUR);
    expect((await collect(player.user, mill)).body.data).toMatchObject({ cycles: 1 });
    expect(await stockOf(player.houseId)).toEqual({ wheat: '80/75', flour: FLOUR });
  });

  it('récolte et vente simultanées du même stock : jamais plus que le stock, jamais d’erreur interne', async () => {
    const players = await Promise.all(Array.from({ length: 8 }, () => newPlayer('mill_flour')));
    await Promise.all(
      players.map(async (player) => {
        const [mill] = player.sites as [string];
        await give(player.houseId, 'wheat', 80);
        await age(mill, 8 * MILL.durationMinutes);
        const [milled, sold] = await Promise.all([
          collect(player.user, mill),
          sell(player.user, 'wheat', 50),
        ]);
        expect(milled.status).toBe(200);
        const stock = await stockOf(player.houseId);
        if (sold.status === 200) {
          // La vente est passée d'abord : la mouture s'est contentée des 30 unités libres.
          expect(milled.body.data.cycles).toBe(3);
          expect(stock).toEqual({ wheat: '50/50', flour: 3 * FLOUR });
        } else {
          // La mouture est passée d'abord : il ne reste rien à vendre.
          expect(sold.body.error?.code).toBe('INSUFFICIENT_STOCK');
          expect(milled.body.data.cycles).toBe(8);
          expect(stock).toEqual({ wheat: 0, flour: 8 * FLOUR });
        }
      }),
    );
  });

  it('un atelier à court d’intrants change de recette ; s’il a de quoi tourner, il se récolte d’abord', async () => {
    const player = await newPlayer('mill_flour');
    const [mill] = player.sites as [string];
    const change = (recipeId: string) =>
      send(player.user, 'site.setRecipe', { siteId: mill, recipeId });
    await age(mill, 3 * MILL.durationMinutes);
    // Aucun stock de blé, pas même une ligne : rien à moudre, mais rien n'empêche de changer.
    expect((await collect(player.user, mill)).body.error?.code).toBe('MISSING_INPUTS');
    // De quoi moudre une fois : il faut récolter d'abord.
    await give(player.houseId, 'wheat', WHEAT_PER_FLOUR);
    expect((await change('bake_bread')).body.error?.code).toBe('COLLECT_FIRST');
    expect((await collect(player.user, mill)).body.data).toMatchObject({ cycles: 1 });
    // Deux cycles attendent encore, sans blé : le changement passe, et ils sont perdus.
    expect((await collect(player.user, mill)).body.error?.code).toBe('MISSING_INPUTS');
    expect((await change('bake_bread')).status).toBe(200);
    await give(player.houseId, 'charcoal', 10 * CHARCOAL_PER_BREAD);
    expect((await collect(player.user, mill)).body.error?.code).toBe('NOTHING_TO_COLLECT');
    expect(await stockOf(player.houseId)).toEqual({
      wheat: 0,
      flour: FLOUR,
      charcoal: 10 * CHARCOAL_PER_BREAD,
    });
    // Du blé réservé par une vente ne compte pas : le moulin reste « à court ».
    expect((await change('mill_flour')).status).toBe(200);
    await give(player.houseId, 'wheat', WHEAT_PER_FLOUR);
    expect((await sell(player.user, 'wheat', WHEAT_PER_FLOUR)).status).toBe(200);
    await age(mill, MILL.durationMinutes);
    expect((await change('bake_bread')).status).toBe(200);
  });

  it('moulin et four de la même maison récoltés ensemble : la farine n’est ni créée ni perdue', async () => {
    const players = await Promise.all(
      Array.from({ length: 6 }, () => newPlayer('mill_flour', 'bake_bread')),
    );
    await Promise.all(
      players.map(async (player) => {
        const [mill, bakery] = player.sites as [string, string];
        await give(player.houseId, 'wheat', 4 * WHEAT_PER_FLOUR);
        await give(player.houseId, 'charcoal', 100);
        await Promise.all([
          age(mill, 4 * MILL.durationMinutes),
          age(bakery, 4 * BAKERY.durationMinutes),
        ]);
        // Première récolte des deux : le stock de farine n'existe pas encore.
        const [milled, baked] = await Promise.all([
          collect(player.user, mill),
          collect(player.user, bakery),
        ]);
        expect(milled.body.data).toMatchObject({ cycles: 4 });
        // Le four passe avant la mouture (pas de farine) ou après (farine pour cinq fournées, quatre dues).
        const bakes = baked.status === 200 ? (baked.body.data.cycles as number) : 0;
        if (baked.status !== 200) expect(baked.body.error?.code).toBe('MISSING_INPUTS');
        else expect(bakes).toBe(4);
        expect(await stockOf(player.houseId)).toEqual({
          wheat: 0,
          flour: 4 * FLOUR - bakes * FLOUR_PER_BREAD,
          charcoal: 100 - bakes * CHARCOAL_PER_BREAD,
          ...(baked.status === 200 ? { bread: bakes * BREAD } : {}),
        });
      }),
    );
  });

  it('le temps perdu faute d’intrants ne se rattrape pas au-delà du plafond du site', async () => {
    const player = await newPlayer('mill_flour');
    const [mill] = player.sites as [string];
    const cap = MILL.maxAccruedCycles;
    await give(player.houseId, 'wheat', 8 * WHEAT_PER_FLOUR);
    await age(mill, (cap + 30) * MILL.durationMinutes);
    expect((await collect(player.user, mill)).body.data).toMatchObject({ cycles: 8 });
    // Réapprovisionné sans compter : seuls les cycles restants du plafond tournent, pas les trente perdus.
    await give(player.houseId, 'wheat', 10_000);
    expect((await collect(player.user, mill)).body.data).toMatchObject({ cycles: cap - 8 });
    expect((await collect(player.user, mill)).body.error?.code).toBe('NOTHING_TO_COLLECT');
    expect(await stockOf(player.houseId)).toEqual({
      wheat: 10_000 - (cap - 8) * WHEAT_PER_FLOUR,
      flour: cap * FLOUR,
    });
  });

  it('atelier à l’arrêt : aucun intrant consommé, même réapprovisionné ; ses cycles dus tournent après la relance', async () => {
    const player = await newPlayer('mill_flour');
    const [mill] = player.sites as [string];
    // Trois cycles d'âge dont le dernier à l'arrêt : deux cycles dus, sans blé pour les faire tourner.
    await age(mill, 3 * MILL.durationMinutes);
    const halt = (statement: ReturnType<typeof sql>) =>
      owner.transaction().execute(async (trx) => {
        await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
        await statement.execute(trx);
        await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
      });
    await halt(
      sql`update game.sites set halted_at = now() - ${`${MILL.durationMinutes} minutes`}::interval where id = ${mill}`,
    );
    // Le blé arrive pendant l'arrêt : l'atelier n'y touche pas.
    await give(player.houseId, 'wheat', 5 * WHEAT_PER_FLOUR);
    expect(await collect(player.user, mill)).toMatchObject({
      status: 409,
      body: { error: { code: 'SITE_HALTED' } },
    });
    expect(await stockOf(player.houseId)).toEqual({ wheat: 5 * WHEAT_PER_FLOUR });
    // Relancé (comme le fait le service), il fait tourner ses deux cycles dus, pas le temps de l'arrêt.
    await sql`update game.sites set halted_at = null,
      cycle_started_at = cycle_started_at + extract(epoch from now() - halted_at) * interval '1 second' where id = ${mill}`.execute(
      db,
    );
    expect((await collect(player.user, mill)).body.data).toMatchObject({ cycles: 2 });
    expect(await stockOf(player.houseId)).toEqual({ wheat: 3 * WHEAT_PER_FLOUR, flour: 2 * FLOUR });
  });
});

import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  balanceOf,
  db,
  ELAIA,
  eventsOf,
  fund,
  give,
  GRANT,
  KALLISTE,
  newPlayer,
  owner,
  send,
} from './property.integration-fixtures';
import { appWithConfig, WORLD, type App } from './voyage.integration-fixtures';

// Offrandes à un dieu, contre Supabase local, avec la configuration initiale : Déméter prend la monnaie à
// 1 Charis par obole, le blé à 6 et le pain à 15. Chaque test fonde sa maison à Kallistè.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const SINK = 'sink_offerings';
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;
type Goods = { goodId: string; quantity: number }[];
const offer = (
  user: string,
  oboles: number,
  goods: Goods,
  charis: number,
  key?: string,
  via?: App,
) =>
  send(
    user,
    'temple.makeOffering',
    { godId: 'demeter', oboles, goods, expectedCharis: charis },
    key,
    via,
  );
const charisOf = async (houseId: string, godId = 'demeter') =>
  Number(
    (
      await sql<{ charis: string }>`select charis from game.favor
        where house_id = ${houseId} and god_id = ${godId}`.execute(db)
    ).rows[0]?.charis ?? 0,
  );
/** Stock libre (hors réservations) d'un bien de la maison dans une cité. */
const freeOf = async (houseId: string, goodId: string, cityId: string = KALLISTE) =>
  Number(
    (
      await sql<{ free: string }>`select quantity - reserved as free from game.inventories
        where house_id = ${houseId} and city_id = ${cityId} and good_id = ${goodId}`.execute(db)
    ).rows[0]?.free ?? 0,
  );
/** Rien n'a bougé pour la maison : ni Charis, ni monnaie, ni blé libre, ni offrande, ni événement. */
async function untouched(houseId: string, balance: number, wheat: number) {
  expect([
    await charisOf(houseId),
    await balanceOf(houseId),
    await freeOf(houseId, 'wheat'),
  ]).toEqual([0, balance, wheat]);
  const offerings = await sql`select id from game.offerings where house_id = ${houseId}`.execute(
    db,
  );
  expect(offerings.rows).toEqual([]);
  expect(await eventsOf(houseId, 'OfferingMade')).toEqual([]);
}

describe('temple.makeOffering', () => {
  it('monnaie au puits, biens à l’extrémité `offering`, Charis au journal, dans une transaction ; rejouable', async () => {
    const player = await newPlayer(KALLISTE);
    await give(player.houseId, 'wheat', 30);
    await give(player.houseId, 'bread', 4);
    const sink = await balanceOf(SINK);
    const goods = [
      { goodId: 'wheat', quantity: 10 },
      { goodId: 'bread', quantity: 2 },
    ];
    const key = randomUUID();
    const done = await offer(player.user, 40, goods, 40 + 60 + 30, key);
    expect(done).toMatchObject({
      status: 200,
      body: {
        data: {
          godId: 'demeter',
          oboles: 40,
          goods: [...goods].reverse(),
          charisGained: 130,
          charis: 130,
        },
      },
    });
    const offeringId = done.body.data.offeringId as string;
    expect([
      await charisOf(player.houseId),
      await balanceOf(player.houseId),
      await balanceOf(SINK),
      await freeOf(player.houseId, 'wheat'),
      await freeOf(player.houseId, 'bread'),
    ]).toEqual([130, GRANT - 40, sink + 40, 20, 2]);
    const moved = await sql<{ moved: string; lines: string }>`select
        (select string_agg(s.good_id || ':' || s.quantity || ':' || s.to_system, ' ' order by s.good_id)
         from game.stock_ledger s where s.offering_id = o.id) as moved,
        (select string_agg(coalesce(a.system_key, a.kind) || ':' || l.amount, ' ' order by l.amount)
         from game.ledger_lines l join game.accounts a on a.id = l.account_id where l.entry_id = o.ledger_entry_id) as lines
      from game.offerings o where o.id = ${offeringId}`.execute(db);
    expect(moved.rows).toEqual([
      { moved: 'bread:2:offering wheat:10:offering', lines: `house:-40 ${SINK}:40` },
    ]);
    expect(await eventsOf(player.houseId, 'OfferingMade')).toEqual([
      {
        offeringId,
        houseId: player.houseId,
        cityId: KALLISTE,
        godId: 'demeter',
        oboles: 40,
        goods: [...goods].reverse(),
        charisGained: 130,
      },
    ]);
    // Rejeu de la même clé : même réponse, rien de plus offert ni gagné.
    expect(await offer(player.user, 40, goods, 130, key)).toEqual(done);
    expect([await charisOf(player.houseId), await balanceOf(player.houseId)]).toEqual([
      130,
      GRANT - 40,
    ]);
    // Une seconde offrande, de biens seuls, s'ajoute à la Charis, sans écriture de monnaie.
    const second = await offer(player.user, 0, [{ goodId: 'wheat', quantity: 1 }], 6);
    expect(second.body.data).toMatchObject({ charisGained: 6, charis: 136 });
    const entry = await sql`select ledger_entry_id from game.offerings
      where id = ${second.body.data.offeringId as string}`.execute(db);
    expect(entry.rows).toEqual([{ ledger_entry_id: null }]);
  });

  it('un stock réservé par une vente, ou dans une autre cité, n’est pas offert ; rien ne bouge', async () => {
    const player = await newPlayer(KALLISTE);
    await give(player.houseId, 'wheat', 10);
    await give(player.houseId, 'wheat', 50, ELAIA);
    const sale = { cityId: KALLISTE, goodId: 'wheat', side: 'sell', price: 999, quantity: 4 };
    expect((await send(player.user, 'market.placeOrder', sale)).status).toBe(200);
    // Dix blés à Kallistè, dont quatre réservés : sept ne passent pas, six oui.
    expect(codeOf(await offer(player.user, 0, [{ goodId: 'wheat', quantity: 7 }], 42))).toBe(
      'INSUFFICIENT_STOCK',
    );
    await untouched(player.houseId, GRANT, 6);
    expect(await freeOf(player.houseId, 'wheat', ELAIA)).toBe(50);
    expect((await offer(player.user, 0, [{ goodId: 'wheat', quantity: 6 }], 36)).status).toBe(200);
    expect([await freeOf(player.houseId, 'wheat'), await charisOf(player.houseId)]).toEqual([
      0, 36,
    ]);
    // La vente garde ses quatre blés réservés.
    const stock = await sql<{ quantity: string; reserved: string }>`select quantity, reserved
      from game.inventories where house_id = ${player.houseId} and city_id = ${KALLISTE} and good_id = 'wheat'`.execute(
      db,
    );
    expect(stock.rows).toEqual([{ quantity: '4', reserved: '4' }]);
  });

  it('refus sans effet : dieu inconnu, don refusé, Charis changée, monnaie insuffisante, offrande vide', async () => {
    const player = await newPlayer(KALLISTE);
    await give(player.houseId, 'wheat', 5);
    const fish = [{ goodId: 'fish', quantity: 1 }];
    const wheat = [{ goodId: 'wheat', quantity: 5 }];
    const reply = (godId: string, oboles: number, goods: Goods, charis: number, via?: App) =>
      send(
        player.user,
        'temple.makeOffering',
        { godId, oboles, goods, expectedCharis: charis },
        undefined,
        via,
      );
    expect(codeOf(await reply('zeus', 10, [], 10))).toBe('GOD_NOT_FOUND');
    // Déméter ne prend pas le poisson ; Apollon ne prend que la monnaie.
    expect(codeOf(await reply('demeter', 10, fish, 22))).toBe('OFFERING_REFUSED');
    expect(codeOf(await reply('apollo', 0, wheat, 30))).toBe('OFFERING_REFUSED');
    expect(codeOf(await reply('demeter', 10, wheat, 39))).toBe('CHARIS_CHANGED');
    // Une version activée entre l'affichage et le clic change le taux : la Charis vue est refusée.
    const dearer = appWithConfig((config) => ({
      ...config,
      gods: config.gods.map((god) => (god.id === 'demeter' ? { ...god, charisPerObole: 2 } : god)),
    }));
    expect(codeOf(await reply('demeter', 10, wheat, 40, dearer))).toBe('CHARIS_CHANGED');
    // Une version qui ne prend plus la monnaie refuse l'offrande, même à la Charis vue.
    const moneyless = appWithConfig((config) => ({
      ...config,
      gods: config.gods.map((god) => (god.id === 'demeter' ? { ...god, charisPerObole: 0 } : god)),
    }));
    expect(codeOf(await reply('demeter', 10, wheat, 40, moneyless))).toBe('OFFERING_REFUSED');
    expect(codeOf(await reply('demeter', GRANT + 1, [], GRANT + 1))).toBe('INSUFFICIENT_FUNDS');
    expect(await reply('demeter', 0, [], 1)).toMatchObject({
      status: 400,
      body: { error: { code: 'VALIDATION_FAILED' } },
    });
    await untouched(player.houseId, GRANT, 5);
  });

  it('deux offrandes à la fois, chacune de toute la trésorerie : une seule passe, une seule Charis', async () => {
    const player = await newPlayer(KALLISTE);
    const replies = await Promise.all([
      offer(player.user, GRANT, [], GRANT),
      offer(player.user, GRANT, [], GRANT),
    ]);
    expect(replies.map((reply) => codeOf(reply) ?? reply.status).sort()).toEqual([
      200,
      'INSUFFICIENT_FUNDS',
    ]);
    expect([await balanceOf(player.houseId), await charisOf(player.houseId)]).toEqual([0, GRANT]);
  });

  it('la Charis avant l’agora : une clôture qui tient la Charis puis prend l’agora ne s’interbloque pas', async () => {
    const player = await newPlayer(KALLISTE);
    await fund(player.houseId, 100);
    expect((await offer(player.user, 10, [], 10)).status).toBe(200);
    // Comme le déclin de la clôture : la Charis de la maison verrouillée, puis l'agora du monde.
    const { offering } = await owner.transaction().execute(async (close) => {
      await sql`set local lock_timeout = '10s'`.execute(close);
      await sql`select 1 from game.favor where house_id = ${player.houseId} for update`.execute(
        close,
      );
      const offering = offer(player.user, 10, [], 10);
      // L'offrande attend la Charis.
      for (let tries = 0; ; tries += 1) {
        const waiting = await sql<{ n: string }>`select count(*) as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock' and query like '%"favor"%'`.execute(
          owner,
        );
        if (Number(waiting.rows[0]?.n) > 0) break;
        if (tries > 100) throw new Error('the offering never waited for the Charis lock');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${WORLD}`}, 0))`.execute(
        close,
      );
      return { offering };
    });
    expect((await offering).status).toBe(200);
    expect(await charisOf(player.houseId)).toBe(20);
  });
});

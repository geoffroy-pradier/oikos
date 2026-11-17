import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  balanceOf,
  db,
  ELAIA,
  eventsOf,
  GRANT,
  KALLISTE,
  newPlayer,
  owner,
  send,
} from './property.integration-fixtures';
import { TEST_CONFIG } from './test-config';
import { appWithConfig, HALOS, WORLD, type App } from './voyage.integration-fixtures';
import { planEvent, waitUntil } from './world-events.integration-fixtures';

// Consultation de la Pythie (#270), contre Supabase local, avec la configuration initiale : IA coupée, Apollon prend
// la monnaie à 1 Charis par obole. Les événements du monde de test commencent dans un mois, sauf mention : ils
// n'agissent sur aucun autre test.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const PRICE = TEST_CONFIG.config.oracle?.consultationOboles ?? NaN;
const MONTH = 30 * 86_400_000;
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;
const consult = (user: string, expectedOboles = PRICE, key?: string, via?: App) =>
  send(user, 'temple.consultOracle', { expectedOboles }, key, via);
const apollo = async (houseId: string) =>
  Number(
    (
      await sql<{ charis: string }>`select charis from game.favor
        where house_id = ${houseId} and god_id = 'apollo'`.execute(db)
    ).rows[0]?.charis ?? 0,
  );
const consultationsOf = async (houseId: string) =>
  (
    await sql<{ oracle_ids: string[]; kind: string; lines: number }>`
      select c.oracle_ids, e.kind, (select count(*)::int from game.ledger_lines l where l.entry_id = e.id) as lines
      from game.oracle_consultations c
      join game.offerings o on o.id = c.offering_id
      join game.ledger_entries e on e.id = o.ledger_entry_id
      where c.house_id = ${houseId} order by c.created_at`.execute(db)
  ).rows;
/** Oracles d'événements à venir de la cité dans le monde de test : ce qu'une consultation doit rendre. */
const upcomingOf = async (cityId: string) =>
  (
    await sql<{
      id: string;
    }>`select o.id from game.oracles o join game.world_events e on e.id = o.event_id
      where e.world_id = ${WORLD} and ${cityId} in (e.city_id, e.other_city_id) and e.starts_at > now()
      order by o.id`.execute(db)
  ).rows.map((row) => row.id);
const oracle = (name: string) => ({ fr: `Oracle ${name}`, en: `Oracle ${name}` });
const plan = (
  model: 'drought' | 'storm' | 'caravan',
  cityId: string,
  extra: { otherCityId?: string; goodId?: string; inMs?: number; lastsMs?: number } = {},
) =>
  planEvent(owner, {
    worldId: WORLD,
    model,
    cityId,
    magnitudeBps: 1_000,
    inMs: MONTH,
    lastsMs: 86_400_000,
    oracle: oracle(`${model} ${randomUUID()}`),
    ...extra,
  });

describe('temple.consultOracle (#270)', () => {
  it('IA coupée : une offrande à Apollon, au puits, qui rend les oracles de repli des événements à venir de la cité', async () => {
    const drought = await plan('drought', KALLISTE);
    const storm = await plan('storm', ELAIA, { otherCityId: KALLISTE });
    const caravan = await plan('caravan', ELAIA, { goodId: 'wine' });
    const player = await newPlayer(KALLISTE);
    const sink = await balanceOf('sink_offerings');
    const done = await consult(player.user);
    expect(done.status).toBe(200);
    const ids = done.body.data.oracles.map((entry: { oracleId: string }) => entry.oracleId);
    expect(ids).toEqual(await upcomingOf(KALLISTE));
    expect(ids).toEqual(expect.arrayContaining([drought.oracleId, storm.oracleId]));
    expect(ids).not.toContain(caravan.oracleId);
    expect(done.body.data.oracles).toContainEqual({
      oracleId: drought.oracleId,
      ...(
        await sql<{ fr: string; en: string }>`select text_fr as fr, text_en as en from game.oracles
        where id = ${drought.oracleId}`.execute(db)
      ).rows[0],
      source: 'fallback',
    });
    expect(done.body.data).toMatchObject({
      godId: 'apollo',
      oboles: PRICE,
      charisGained: PRICE,
      charis: PRICE,
    });
    // Les oboles sont détruites, en entiers : rien n'est créé, rien ne se perd entre la maison et le puits.
    expect([await balanceOf(player.houseId), (await balanceOf('sink_offerings')) - sink]).toEqual([
      GRANT - PRICE,
      PRICE,
    ]);
    expect(await apollo(player.houseId)).toBe(PRICE);
    expect(await consultationsOf(player.houseId)).toEqual([
      { oracle_ids: ids, kind: 'temple.oracle', lines: 2 },
    ]);
    const flows = await sql<{
      nature: string;
      amount: string;
    }>`select nature, amount from public.my_cash_flows
      where house_id = ${player.houseId} and nature = 'offerings'`.execute(owner);
    expect(flows.rows.map((row) => [row.nature, Number(row.amount)])).toEqual([
      ['offerings', -PRICE],
    ]);
    expect(await eventsOf(player.houseId, 'OracleConsulted')).toEqual([
      {
        consultationId: done.body.data.consultationId,
        offeringId: done.body.data.offeringId,
        houseId: player.houseId,
        cityId: KALLISTE,
        godId: 'apollo',
        oboles: PRICE,
        charisGained: PRICE,
        oracleIds: ids,
      },
    ]);
  });

  it('idempotente : la même clé rend la même réponse, sans payer deux fois, même à la fois', async () => {
    await plan('drought', KALLISTE);
    const player = await newPlayer(KALLISTE);
    const key = randomUUID();
    const [first, second] = await Promise.all([
      consult(player.user, PRICE, key),
      consult(player.user, PRICE, key),
    ]);
    const third = await consult(player.user, PRICE, key);
    expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);
    expect(second.body).toEqual(first.body);
    expect(third.body).toEqual(first.body);
    expect([await balanceOf(player.houseId), await apollo(player.houseId)]).toEqual([
      GRANT - PRICE,
      PRICE,
    ]);
    expect(await consultationsOf(player.houseId)).toHaveLength(1);
    expect(await eventsOf(player.houseId, 'OracleConsulted')).toHaveLength(1);
  });

  it('deux consultations à la fois, la trésorerie ne couvrant qu’une : une seule passe, une seule Charis', async () => {
    const player = await newPlayer(KALLISTE);
    const dear = appWithConfig((config) => ({
      ...config,
      oracle: { godId: 'apollo', consultationOboles: GRANT, maxTextLength: 400 },
    }));
    const replies = await Promise.all([
      consult(player.user, GRANT, undefined, dear),
      consult(player.user, GRANT, undefined, dear),
    ]);
    expect(replies.map((reply) => codeOf(reply) ?? reply.status).sort()).toEqual([
      200,
      'INSUFFICIENT_FUNDS',
    ]);
    expect([await balanceOf(player.houseId), await apollo(player.houseId)]).toEqual([0, GRANT]);
    expect(await consultationsOf(player.houseId)).toHaveLength(1);
  });

  it('refus sans effet : prix changé, monnaie insuffisante, Pythie absente de la configuration, sans maison', async () => {
    const player = await newPlayer(KALLISTE);
    const dear = appWithConfig((config) => ({
      ...config,
      oracle: { godId: 'apollo', consultationOboles: GRANT + 1, maxTextLength: 400 },
    }));
    const older = appWithConfig(({ oracle: _, ...config }) => config);
    for (const [reply, code] of [
      [await consult(player.user, PRICE + 1), 'PRICE_CHANGED'],
      [await consult(player.user, GRANT + 1, undefined, dear), 'INSUFFICIENT_FUNDS'],
      [await consult(player.user, PRICE, undefined, older), 'ORACLE_UNAVAILABLE'],
      [await consult(randomUUID()), 'HOUSE_NOT_FOUND'],
    ] as const)
      expect([codeOf(reply), reply.status >= 400]).toEqual([code, true]);
    expect([await balanceOf(player.houseId), await apollo(player.houseId)]).toEqual([GRANT, 0]);
    expect(await consultationsOf(player.houseId)).toEqual([]);
    expect(await eventsOf(player.houseId, 'OracleConsulted')).toEqual([]);
  });

  it('un événement commencé n’est plus rendu ; une cité sans événement à venir se consulte quand même', async () => {
    // Une caravane, d'une minute : elle n'agit sur aucune commande des autres tests (récoltes, départs).
    const soon = await plan('caravan', KALLISTE, { goodId: 'wine', inMs: 300, lastsMs: 60_000 });
    await waitUntil(db, soon.startsAt);
    const player = await newPlayer(KALLISTE);
    const done = await consult(player.user);
    expect(done.status).toBe(200);
    expect(
      done.body.data.oracles.map((entry: { oracleId: string }) => entry.oracleId),
    ).not.toContain(soon.oracleId);
    const lonely = await newPlayer(HALOS);
    expect(await upcomingOf(HALOS)).toEqual([]);
    const empty = await consult(lonely.user);
    expect([empty.status, empty.body.data.oracles]).toEqual([200, []]);
    expect(await balanceOf(lonely.houseId)).toBe(GRANT - PRICE);
  });
});

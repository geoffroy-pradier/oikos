import { randomUUID } from 'node:crypto';
import type { GameConfig } from '@oikos/config';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  balanceOf,
  db,
  eventsOf,
  GRANT,
  KALLISTE,
  newPlayer,
  owner,
  send,
} from './property.integration-fixtures';
import { appWithConfig, type App } from './voyage.integration-fixtures';

// Accomplissement d'une liturgie (#720), contre Supabase local. Kallistè a Déméter pour dieu protecteur. Chaque test
// fonde ses maisons, dotées de la dotation de départ, et leur pose une liturgie désignée.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const SINK = 'sink_liturgies';
type Rules = NonNullable<GameConfig['liturgies']>;
const RULES: Partial<Rules> = { honorGain: 10, charisGain: 20, maxSplendorBps: 5_000 };
const withRules = (rules: Partial<Rules> | null, honorMax?: number): App =>
  appWithConfig((config) => {
    const next: GameConfig = { ...config };
    if (rules && config.liturgies) next.liturgies = { ...config.liturgies, ...rules };
    else delete next.liturgies;
    if (honorMax !== undefined && config.honor) next.honor = { ...config.honor, max: honorMax };
    return next;
  });
const app = withRules(RULES);
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;

/**
 * Une liturgie désignée pour la maison, à Kallistè, échue dans `dueIn` (négatif : déjà échue). Posée par le
 * propriétaire de la base, gardes levées pour cette seule transaction : sa désignation demande une clôture du monde.
 */
async function assign(houseId: string, due: number, dueIn = '1 day') {
  return owner.transaction().execute(async (trx) => {
    await sql`set local session_replication_role = replica`.execute(trx);
    const { rows } = await sql<{ id: string }>`insert into game.liturgies
        (world_id, city_id, house_id, season, genre, due, designated_day, due_day, due_at)
      select world_id, ${KALLISTE}, id, 1, 'choregia', ${due}, 10, 13, now() + ${dueIn}::interval
      from game.houses where id = ${houseId} returning id`.execute(trx);
    return rows[0]?.id ?? '';
  });
}
const perform = (
  user: string,
  liturgyId: string,
  due: number,
  splendor: number,
  key?: string,
  via = app,
) => send(user, 'liturgy.perform', { liturgyId, expectedDue: due, splendor }, key, via);
/** État, faste, oboles payées, dieu et Charis de la liturgie (les valeurs nulles omises). */
const stateOf = async (id: string) =>
  (
    await sql<{
      s: string;
    }>`select concat_ws(':', status, splendor, paid, god_id, charis_gained) as s
      from game.liturgies where id = ${id}`.execute(db)
  ).rows[0]?.s;
/** Trésorerie, Charis envers Déméter et Timè de la maison. */
const holdingsOf = async (houseId: string) =>
  (
    await sql<{ v: string[] }>`select array[
      (select balance from game.accounts where house_id = ${houseId} and kind = 'house'),
      coalesce((select charis from game.favor where house_id = ${houseId} and god_id = 'demeter'), 0),
      coalesce((select honor from game.honor where house_id = ${houseId}), 0)]::text[] as v`.execute(
      db,
    )
  ).rows[0]?.v.map(Number);
/** Lignes des écritures de la liturgie : compte (clé système ou `house`) et montant. */
const linesOf = async (liturgyId: string) =>
  (
    await sql<{
      line: string;
    }>`select e.kind || ':' || coalesce(a.system_key, a.kind) || ':' || l.amount as line
      from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id join game.accounts a on a.id = l.account_id
      where e.meta->>'liturgyId' = ${liturgyId} order by l.amount`.execute(db)
  ).rows.map((row) => row.line);

describe('liturgy.perform', () => {
  it('dû et faste au puits en une écriture, Timè et Charis une fois, arrondies vers le bas ; rejouable', async () => {
    const player = await newPlayer(KALLISTE);
    // Dû de 301 : faste borné à ⌊301 × 5 000 ÷ 10 000⌋ = 150 ; gains ⌊20 × 451 ÷ 301⌋ = 29 et ⌊10 × 451 ÷ 301⌋ = 14.
    const liturgyId = await assign(player.houseId, 301);
    const sink = await balanceOf(SINK);
    const key = randomUUID();
    const done = await perform(player.user, liturgyId, 301, 150, key);
    expect(done).toMatchObject({
      status: 200,
      body: {
        data: {
          liturgyId,
          cityId: KALLISTE,
          season: 1,
          genre: 'choregia',
          due: 301,
          splendor: 150,
        },
      },
    });
    expect(done.body.data).toMatchObject({ honorGained: 14, charisGained: 29, godId: 'demeter' });
    expect(await balanceOf(SINK)).toBe(sink + 451);
    expect(await linesOf(liturgyId)).toEqual([
      'liturgy.perform:house:-451',
      `liturgy.perform:${SINK}:451`,
    ]);
    expect(await stateOf(liturgyId)).toBe('performed:150:451:demeter:29');
    expect(await holdingsOf(player.houseId)).toEqual([GRANT - 451, 29, 14]);
    const { houseId } = player;
    expect(await eventsOf(houseId, 'LiturgyPerformed')).toEqual([{ ...done.body.data, houseId }]);
    expect(await eventsOf(houseId, 'HonorChanged')).toEqual([
      { houseId, amount: 14, reason: 'liturgy_performed', balance: 14 },
    ]);
    // Les deux événements sont ceux de la commande.
    const commands =
      await sql`select distinct command_id from game.domain_events where command_id is not null
      and payload->>'houseId' = ${houseId} and type in ('LiturgyPerformed', 'HonorChanged')`.execute(
        db,
      );
    expect(commands.rows).toHaveLength(1);
    // Même clé : même réponse, rien de plus payé ni gagné ; autre clé : déjà accomplie.
    expect(await perform(player.user, liturgyId, 301, 150, key)).toEqual(done);
    expect(codeOf(await perform(player.user, liturgyId, 301, 0))).toBe('LITURGY_SETTLED');
    expect(await holdingsOf(houseId)).toEqual([GRANT - 451, 29, 14]);
  });

  it('refus sans rien payer : autre maison, dû changé, faste hors borne, échéance passée, trésorerie insuffisante', async () => {
    const [player, other] = [await newPlayer(KALLISTE), await newPlayer(KALLISTE)];
    const liturgyId = await assign(player.houseId, 1_000);
    const overdue = await assign(other.houseId, 100, '-1 minute');
    const sink = await balanceOf(SINK);
    const refusals = [
      [await perform(other.user, liturgyId, 1_000, 0), 'LITURGY_NOT_FOUND'],
      [await perform(player.user, randomUUID(), 1_000, 0), 'LITURGY_NOT_FOUND'],
      [await perform(player.user, liturgyId, 999, 0), 'PRICE_CHANGED'],
      [await perform(player.user, liturgyId, 1_000, 501), 'SPLENDOR_OUT_OF_BOUNDS'],
      [await perform(other.user, overdue, 100, 0), 'LITURGY_OVERDUE'],
    ] as const;
    for (const [reply, code] of refusals) expect(codeOf(reply)).toBe(code);
    // Trésorerie de 3 000 : 2 001 et un faste de 1 000 ne passent pas ; 2 000 et 1 000 passent, à l'obole près.
    const [poor, rich] = [await newPlayer(KALLISTE), await newPlayer(KALLISTE)];
    const short = await assign(poor.houseId, 2_001);
    expect(codeOf(await perform(poor.user, short, 2_001, 1_000))).toBe('INSUFFICIENT_FUNDS');
    for (const house of [player, other, poor]) {
      expect(await holdingsOf(house.houseId)).toEqual([GRANT, 0, 0]);
      expect(await eventsOf(house.houseId, 'LiturgyPerformed')).toEqual([]);
    }
    for (const id of [liturgyId, overdue, short]) expect(await stateOf(id)).toBe('assigned');
    expect(await balanceOf(SINK)).toBe(sink);
    const exact = await assign(rich.houseId, 2_000);
    expect((await perform(rich.user, exact, 2_000, 1_000)).body.data).toMatchObject({
      splendor: 1_000,
    });
    expect([(await holdingsOf(rich.houseId))?.[0], await balanceOf(SINK)]).toEqual([
      0,
      sink + GRANT,
    ]);
  });

  it('deux accomplissements concurrents, sous deux clés : un seul paie et gagne, l’autre trouve la liturgie réglée', async () => {
    const player = await newPlayer(KALLISTE);
    const liturgyId = await assign(player.houseId, 400);
    const sink = await balanceOf(SINK);
    const replies = await Promise.all([
      perform(player.user, liturgyId, 400, 200),
      perform(player.user, liturgyId, 400, 0),
    ]);
    const done = replies.filter((reply) => reply.status === 200);
    expect(done).toHaveLength(1);
    expect(replies.map(codeOf).filter(Boolean)).toEqual(['LITURGY_SETTLED']);
    const paid = 400 + (done[0]?.body.data.splendor as number);
    expect(await balanceOf(SINK)).toBe(sink + paid);
    expect(await linesOf(liturgyId)).toHaveLength(2);
    // Gains de l'accomplissement qui a payé, une fois : 30 Charis et 15 Timè, ou 20 et 10.
    const gains = paid === 600 ? [30, 15] : [20, 10];
    expect(await holdingsOf(player.houseId)).toEqual([GRANT - paid, ...gains]);
    expect(await eventsOf(player.houseId, 'LiturgyPerformed')).toHaveLength(1);
  });

  it('sans section `liturgies` : le dû seul, sans faste ni gain ; Timè rognée à sa borne', async () => {
    const bare = withRules(null);
    const player = await newPlayer(KALLISTE);
    const liturgyId = await assign(player.houseId, 50);
    expect(codeOf(await perform(player.user, liturgyId, 50, 1, undefined, bare))).toBe(
      'SPLENDOR_OUT_OF_BOUNDS',
    );
    const done = await perform(player.user, liturgyId, 50, 0, undefined, bare);
    expect(done.body.data).toMatchObject({ honorGained: 0, charisGained: 0, godId: null });
    expect(await stateOf(liturgyId)).toBe('performed:0:50');
    expect(await holdingsOf(player.houseId)).toEqual([GRANT - 50, 0, 0]);
    expect(await eventsOf(player.houseId, 'HonorChanged')).toEqual([]);
    // Timè au plus 4 : le gain de 10 est rogné à 4.
    const capped = await newPlayer(KALLISTE);
    const second = await assign(capped.houseId, 50);
    const reply = await perform(capped.user, second, 50, 0, undefined, withRules(RULES, 4));
    expect(reply.body.data).toMatchObject({ honorGained: 4, charisGained: 20 });
    expect(await holdingsOf(capped.houseId)).toEqual([GRANT - 50, 20, 4]);
  });
});

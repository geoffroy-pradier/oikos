import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { HONOR_REASONS } from '@oikos/contracts';
import { createDb, recordHonorChange, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt, honorChange } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyClose, type CloseStep } from '../close';
import { archonHonor } from './archon-honor';

// Timè des mandats d'archonte menés à leur terme (#704), contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
const TODAY = gameDayAt(new Date(), clock);
const at = (day: number) => dailyCloseAt(day, clock);
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const rules = (archon_term: number, max = 10_000): GameConfig['honor'] => ({
  min: -10_000,
  max,
  changes: { archon_term },
});
const close = (worldId: string, honor: GameConfig['honor'], steps: CloseStep[] = [archonHonor]) =>
  runDailyClose(db, {
    worldId,
    gameDay: TODAY,
    closeAt: at(TODAY),
    config: { at: async () => ({ ...loaded, config: { ...initial, clock, honor } }) },
    steps,
    now: new Date(),
  });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/**
 * Un monde, une cité par maison, et la clôture d'hier enregistrée. Chaque mandat `[maison, fin]` (jour de jeu de sa
 * fin, 28 jours après son début sauf durée donnée) est posé par le propriétaire, élection dépouillée, garde de la charge levée.
 */
async function newWorld(
  houses: number,
  terms: [house: number, endDay: number, days?: number][],
  closed = true,
) {
  const worldId = randomUUID();
  const houseIds = Array.from({ length: houses }, () => randomUUID()).sort();
  const officeIds: string[] = [];
  await owner.transaction().execute(async (trx) => {
    await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`h-${worldId.slice(0, 12)}`}, 'Test')`.execute(
      trx,
    );
    for (const [rank, houseId] of houseIds.entries()) {
      const userId = randomUUID();
      await sql`with player as (insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})),
        city as (insert into game.cities (id, world_id, slug, name) values (${houseId}, ${worldId}, ${`cite-${rank}`}, 'Cité'))
        insert into game.houses (id, world_id, user_id, name, blazon)
        values (${houseId}, ${worldId}, ${userId}, ${`Maison ${houseId.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}')`.execute(
        trx,
      );
    }
    await sql`alter table game.offices disable trigger offices_guard`.execute(trx);
    for (const [house, end, days = 28] of terms) {
      const [electionId, officeId] = [randomUUID(), randomUUID()];
      officeIds.push(officeId);
      const cityId = houseIds[house];
      await sql`insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
        values (${electionId}, ${worldId}, ${cityId}, 'archon', ${at(end - days - 7)}, ${at(end - days - 3)}, ${at(end - days)}, ${at(end)})`.execute(
        trx,
      );
      await sql`update game.elections set tallied_at = now() where id = ${electionId}`.execute(trx);
      await sql`insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
        values (${officeId}, ${worldId}, ${cityId}, 'archon', ${cityId}, ${electionId}, ${at(end - days)}, ${at(end)})`.execute(
        trx,
      );
    }
    await sql`alter table game.offices enable trigger offices_guard`.execute(trx);
    if (closed) await recordClose(trx, worldId, TODAY - 1);
  });
  return { worldId, houseIds, officeIds };
}
/** Clôture d'un jour enregistrée, comme `runDailyClose` l'écrit en dernier. */
const recordClose = (trx: typeof db, worldId: string, day: number) =>
  sql`insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
    values (${worldId}, ${day}, ${at(day)}, ${loaded.id})`.execute(trx);
const rows = async <T>(query: ReturnType<typeof sql<T>>) => (await query.execute(db)).rows;
const honorOf = (houseIds: string[]) =>
  rows(sql<{
    honor: string;
  }>`select coalesce(t.honor, 0) as honor from unnest(${houseIds}::uuid[]) with ordinality h (id, rank)
    left join game.honor t on t.house_id = h.id order by h.rank`).then((found) =>
    found.map((row) => Number(row.honor)),
  );
const ledgerOf = (worldId: string) =>
  rows(sql<{
    reference: string;
    amount: string;
    reason: string;
    game_day: number;
  }>`select reference, amount, reason, game_day
    from game.honor_ledger where world_id = ${worldId} order by reference`);
const eventsOf = (houseIds: string[]) =>
  rows(sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
    where type = 'HonorChanged' and payload->>'houseId' = any(${houseIds}::text[]) order by seq`).then(
    (found) => found.map((row) => row.payload),
  );

describe('Timè des mandats d’archonte (#704)', () => {
  it('la clôture qui atteint la fin d’un mandat crédite sa maison, une fois même rejouée', async () => {
    // Maison 0 : mandat fini à cette clôture ; maison 1 : fini hier (déjà passé), et un mandat en cours.
    const { worldId, houseIds, officeIds } = await newWorld(2, [
      [0, TODAY],
      [1, TODAY - 1],
      [1, TODAY + 27],
    ]);
    const first = await close(worldId, rules(30), [
      archonHonor,
      { ...archonHonor, name: 'archonHonorAgain' },
    ]);
    expect(first).toMatchObject({
      status: 'done',
      summary: {
        archonHonor: { credited: 1, honorGained: 30 },
        archonHonorAgain: { credited: 0, honorGained: 0 },
      },
    });
    expect(await honorOf(houseIds)).toEqual([30, 0]);
    expect(await ledgerOf(worldId)).toEqual([
      { reference: officeIds[0], amount: '30', reason: 'archon_term', game_day: TODAY },
    ]);
    expect(await eventsOf(houseIds)).toEqual([
      { houseId: houseIds[0], amount: 30, reason: 'archon_term', balance: 30 },
    ]);
    // Rejouée : la clôture du jour est enregistrée, rien ne change.
    expect((await close(worldId, rules(30))).status).toBe('skipped');
    expect([(await ledgerOf(worldId)).length, (await eventsOf(houseIds)).length]).toEqual([1, 1]);
  });

  it('un gain rogné à la borne haute ; à la borne, aucune ligne ni événement', async () => {
    const { worldId, houseIds } = await newWorld(2, [
      [0, TODAY],
      [1, TODAY],
    ]);
    // Maison 1 déjà à 8 : elle ne gagne que 2 ; posée garde levée.
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.honor_ledger disable trigger honor_ledger_guard`.execute(trx);
      await sql`insert into game.honor_ledger (world_id, house_id, amount, reason, reference, game_day)
        values (${worldId}, ${houseIds[1]}, 8, 'test_seed', ${randomUUID()}, ${TODAY - 1})`.execute(
        trx,
      );
      await sql`alter table game.honor_ledger enable trigger honor_ledger_guard`.execute(trx);
    });
    expect((await close(worldId, rules(30, 10))).summary).toEqual({
      archonHonor: { credited: 2, honorGained: 12 },
    });
    expect(await honorOf(houseIds)).toEqual([10, 10]);
    expect((await eventsOf(houseIds)).map((event) => [event['amount'], event['balance']])).toEqual([
      [10, 10],
      [2, 10],
    ]);

    // À la borne : le mandat suivant, fini à une clôture plus tardive, n'écrit rien.
    const full = await newWorld(1, [[0, TODAY]]);
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.honor_ledger disable trigger honor_ledger_guard`.execute(trx);
      await sql`insert into game.honor_ledger (world_id, house_id, amount, reason, reference, game_day)
        values (${full.worldId}, ${full.houseIds[0]}, 10, 'test_seed', ${randomUUID()}, ${TODAY - 1})`.execute(
        trx,
      );
      await sql`alter table game.honor_ledger enable trigger honor_ledger_guard`.execute(trx);
    });
    expect((await close(full.worldId, rules(30, 10))).summary).toEqual({
      archonHonor: { credited: 0, honorGained: 0 },
    });
    expect(await eventsOf(full.houseIds)).toEqual([]);
  });

  it('deux écritures concurrentes de la Timè d’une maison la tiennent dans ses bornes', async () => {
    // Deux transactions qui se chevauchent, chacune avec la clôture de son jour (hier, aujourd'hui) : sans le
    // verrou de la Timè, chacune lirait zéro et la maison finirait à 16 pour une borne de 10.
    const { worldId, houseIds, officeIds } = await newWorld(
      1,
      [
        [0, TODAY - 1],
        [0, TODAY - 1, 27],
      ],
      false,
    );
    const houseId = houseIds[0] ?? '';
    const credit = async (trx: typeof db, reference: string, gameDay: number) => {
      const written = await recordHonorChange(
        trx,
        { worldId, houseId, reason: 'archon_term', reference, gameDay },
        (balance) =>
          honorChange(balance, 'archon_term', { min: 0, max: 10, changes: { archon_term: 8 } }),
      );
      await recordClose(trx, worldId, gameDay);
      return written;
    };
    let second: Promise<unknown> | undefined;
    const first = await db.transaction().execute(async (trx) => {
      const written = await credit(trx, officeIds[0] ?? '', TODAY - 1);
      second = db.transaction().execute((other) => credit(other, officeIds[1] ?? '', TODAY));
      await sql`select pg_sleep(0.3)`.execute(trx);
      return written;
    });
    expect(first).toEqual({ amount: 8, balance: 8 });
    expect(await second).toEqual({ amount: 2, balance: 10 });
    expect(await honorOf(houseIds)).toEqual([10]);
  });

  it('la garde de la base connaît chaque motif des contrats, et aucun autre', async () => {
    const { worldId, houseIds } = await newWorld(1, []);
    const attempt = (reason: string) =>
      sql`insert into game.honor_ledger (world_id, house_id, amount, reason, reference, game_day)
        values (${worldId}, ${houseIds[0]}, 1, ${reason}, ${randomUUID()}, ${TODAY})`
        .execute(db)
        .then(String, (error: Error) => error.message);
    for (const reason of HONOR_REASONS) expect(await attempt(reason)).not.toMatch(/unknown/);
    expect(await attempt('not_a_reason')).toMatch(/unknown Timè reason/);
  });

  it('paramètres neutres ou version publiée avant la Timè : rien ; un mandat fini plus tôt ne l’est jamais après coup', async () => {
    for (const honor of [rules(0), undefined]) {
      const { worldId, houseIds } = await newWorld(1, [[0, TODAY]]);
      expect((await close(worldId, honor)).summary).toEqual({
        archonHonor: { credited: 0, honorGained: 0 },
      });
      expect(await ledgerOf(worldId)).toEqual([]);
      expect(await eventsOf(houseIds)).toEqual([]);
    }
    // Fini avant la clôture d'hier : un gain devenu non nul ne le crédite pas.
    const { worldId } = await newWorld(1, [[0, TODAY - 1]]);
    expect((await close(worldId, rules(30))).summary).toEqual({
      archonHonor: { credited: 0, honorGained: 0 },
    });
    expect(await ledgerOf(worldId)).toEqual([]);
  });
});

import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { bankDepositInterest, dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyClose, type CloseStep } from '../close';
import { CLOSE_STEPS } from '../close-steps';
import { neutralEconomy } from '../neutral.integration-fixtures';
import { bankInterest } from './bank-interest';

// Intérêt des dépôts (#727), contre Supabase local. Chaque test a son monde et joue des clôtures passées, dans l'ordre.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = neutralEconomy(INITIAL_CONFIG as GameConfig);
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
let clock = initial.clock;
let TODAY = 0;
/** Taux de dépôt affiché : 10 % l'an. */
const RATE = 1_000;

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
  const { rows } = await sql<{ hour: number; timezone: string }>`select daily_close_hour as hour,
    timezone from game.clock_rules()`.execute(owner);
  clock = { ...clock, dailyCloseHour: rows[0]?.hour ?? 0, timezone: rows[0]?.timezone ?? 'UTC' };
  TODAY = gameDayAt(new Date(), clock);
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const close = (worldId: string, gameDay: number, steps: readonly CloseStep[] = [bankInterest]) =>
  runDailyClose(db, {
    worldId,
    gameDay,
    closeAt: dailyCloseAt(gameDay, clock),
    config: { at: async () => ({ ...loaded, config: { ...initial, clock } }) },
    steps,
    now: new Date(),
  });

/**
 * Un monde à une cité : la maison 0 fonde une banque au taux de 10 % avec 1 000 oboles de capital ; chaque autre maison y
 * dépose `deposits[i]` oboles, comme l'écrit `bank.deposit`, après une dotation du même montant (aucun dépôt si nul).
 */
async function newWorld(deposits: number[]) {
  const [worldId, cityId] = [randomUUID(), randomUUID()];
  const ids = [0, ...deposits].map(() => randomUUID());
  const users = ids.map(() => randomUUID());
  const bankId = await owner.transaction().execute(async (trx) => {
    for (const statement of [
      sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`b-${worldId.slice(0, 12)}`}, 'Dépôts')`,
      sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Agora')`,
      sql`insert into auth.users (id, email) select u, u || '@example.test' from unnest(${users}::uuid[]) u`,
      sql`insert into game.houses (id, world_id, user_id, name, blazon) select h, ${worldId}, u, 'Maison ' || chr(96 + n::int),
        '{}' from unnest(${ids}::uuid[], ${users}::uuid[]) with ordinality v (h, u, n)`,
      sql`insert into game.citizenships (house_id, city_id) select h, ${cityId} from unnest(${ids}::uuid[]) h`,
      sql`insert into game.accounts (world_id, kind, house_id) select ${worldId}, 'house', h from unnest(${ids}::uuid[]) h`,
    ])
      await statement.execute(trx);
    const post = async (kind: string, from: unknown, to: unknown, amount: number, meta = {}) => {
      const { rows } = await sql<{
        id: string;
      }>`insert into game.ledger_entries (world_id, kind, meta)
        values (${worldId}, ${kind}, ${JSON.stringify(meta)}) returning id`.execute(trx);
      await sql`insert into game.ledger_lines (entry_id, account_id, amount)
        values (${rows[0]?.id}, ${to}, ${amount}), (${rows[0]?.id}, ${from}, ${-amount})`.execute(
        trx,
      );
      return rows[0]?.id ?? '';
    };
    const faucet = sql`(select id from game.accounts where world_id = ${worldId} and system_key = 'faucet_starting_grant')`;
    const treasury = (id: string) =>
      sql`(select id from game.accounts where house_id = ${id} and kind = 'house')`;
    const [banker = ''] = ids;
    await post('house.starting_grant', faucet, treasury(banker), 1_000);
    const { rows } = await sql<{
      id: string;
    }>`insert into game.banks (world_id, city_id, house_id, name,
        deposit_rate_bps, loan_rate_bps, charter_fee)
      values (${worldId}, ${cityId}, ${banker}, 'Trapeza Agorai', ${RATE}, 0, 0) returning id`.execute(
      trx,
    );
    const bankId = rows[0]?.id ?? '';
    const vault = sql`(select id from game.accounts where bank_id = ${bankId})`;
    await post('bank.capital_in', treasury(banker), vault, 1_000, { bankId });
    for (const [index, amount] of deposits.entries()) {
      const id = ids[index + 1] ?? '';
      if (amount === 0) continue;
      await post('house.starting_grant', faucet, treasury(id), amount);
      const { rows: deposit } = await sql<{
        id: string;
      }>`insert into game.bank_deposits (world_id, bank_id, house_id)
        values (${worldId}, ${bankId}, ${id}) returning id`.execute(trx);
      const entry = await post('bank.deposit', treasury(id), vault, amount, { bankId });
      await sql`insert into game.bank_deposit_movements (world_id, deposit_id, bank_id, house_id, kind, amount,
          ledger_entry_id)
        values (${worldId}, ${deposit[0]?.id}, ${bankId}, ${id}, 'deposit', ${amount}, ${entry})`.execute(
        trx,
      );
    }
    return bankId;
  });
  return { worldId, bankId, ids };
}
/** Solde du dépôt de chaque maison, par ordre des maisons ; `null` sans dépôt. */
const heldOf = async (ids: string[]) => {
  const { rows } = await sql<{ house_id: string; balance: string }>`select house_id, balance
    from game.bank_deposits where house_id = any(${ids}::uuid[])`.execute(owner);
  return ids.map((id) => {
    const row = rows.find((r) => r.house_id === id);
    return row ? Number(row.balance) : null;
  });
};
/** Monnaie du monde (soldes de tous ses comptes, hors robinets et puits) et nombre de ses écritures. */
const moneyOf = async (worldId: string) =>
  (
    await sql<{ s: string }>`select (select sum(balance) from game.accounts
        where world_id = ${worldId} and kind <> 'system') || ':' ||
      (select count(*) from game.ledger_entries where world_id = ${worldId}) as s`.execute(owner)
  ).rows[0]?.s;

describe('intérêt des dépôts (#727)', () => {
  it('composé jour après jour, à l’obole inférieure, sans monnaie créée ; rejouée, la clôture ne crédite rien deux fois', async () => {
    // b : un million ; c : 3 000, dont l'intérêt (0,82 par jour) s'arrondit à zéro ; d : rien.
    const { worldId, bankId, ids } = await newWorld([1_000_000, 3_000, 0]);
    const depositors = ids.slice(1);
    const money = await moneyOf(worldId);
    let expected = 1_000_000n;
    const days = [TODAY - 4, TODAY - 3, TODAY - 2, TODAY - 1];
    for (const day of days) {
      const interest = bankDepositInterest(expected, RATE);
      expected += interest;
      expect((await close(worldId, day)).summary).toEqual({
        bankInterest: { credited: 1, interestOboles: Number(interest) },
      });
      expect(await heldOf(depositors)).toEqual([Number(expected), 3_000, null]);
    }
    // 273 le premier jour, 274 dès le deuxième : l'intérêt d'hier rapporte.
    const { rows } = await sql<{
      day: number;
      amount: string;
      rate: number;
    }>`select game_day as day,
        amount, rate_bps as rate from game.bank_deposit_movements
      where bank_id = ${bankId} and kind = 'interest' order by game_day`.execute(owner);
    expect(rows.map((row) => [row.day - TODAY, Number(row.amount), row.rate])).toEqual([
      [-4, 273, RATE],
      [-3, 274, RATE],
      [-2, 274, RATE],
      [-1, 274, RATE],
    ]);
    expect(expected).toBe(1_000_000n + 273n + 3n * 274n);
    // Aucune écriture, aucune obole de plus : la créance grossit, pas la masse monétaire.
    expect(await moneyOf(worldId)).toBe(money);
    // Rejouée, une clôture jouée ne crédite rien ; une plus ancienne non plus.
    expect((await close(worldId, TODAY - 1)).status).toBe('skipped');
    expect((await close(worldId, TODAY - 5)).status).toBe('skipped');
    expect(await heldOf(depositors)).toEqual([Number(expected), 3_000, null]);
    const { rows: events } = await sql<{ payload: Record<string, unknown> }>`select payload
      from game.domain_events where type = 'BankInterestCredited' and payload ->> 'bankId' = ${bankId}
      order by seq`.execute(db);
    expect(events.map((event) => event.payload)).toHaveLength(4);
    expect(events.at(-1)?.payload).toEqual({
      bankId,
      depositId: expect.any(String),
      houseId: depositors[0],
      interest: 274,
      rateBps: RATE,
      balance: Number(expected),
      gameDay: TODAY - 1,
    });
  });

  it('au taux affiché à l’instant de la clôture ; la fortune passe du banquier au déposant ; dans la clôture entière', async () => {
    const { worldId, bankId, ids } = await newWorld([730_000]);
    const [banker = '', saver = ''] = ids;
    const wealth = async () =>
      (
        await sql<{ house_id: string; wealth: string }>`select house_id, wealth
          from game.house_wealth(${worldId})`.execute(db)
      ).rows.reduce<Record<string, number>>(
        (all, row) => ({ ...all, [row.house_id]: Number(row.wealth) }),
        {},
      );
    const before = await wealth();
    // 10 % de 730 000 : 200 oboles par jour juste.
    await close(worldId, TODAY - 2);
    expect(await heldOf([saver])).toEqual([730_200]);
    // Le banquier abaisse son taux à 1 % : la clôture suivante le prend.
    await sql`update game.banks set deposit_rate_bps = 100 where id = ${bankId}`.execute(owner);
    const outcome = await close(worldId, TODAY - 1, CLOSE_STEPS);
    expect(outcome.summary['bankInterest']).toEqual({ credited: 1, interestOboles: 20 });
    expect(await heldOf([saver])).toEqual([730_220]);
    const after = await wealth();
    expect([after[saver], after[banker]]).toEqual([
      (before[saver] ?? 0) + 220,
      (before[banker] ?? 0) - 220,
    ]);
  });
});

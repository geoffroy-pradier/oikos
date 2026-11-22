import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql, type RawBuilder } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyClose, type CloseStep } from '../close';
import { CLOSE_STEPS } from '../close-steps';
import { neutralEconomy } from '../neutral.integration-fixtures';
import { loanCollection, loanDefaultLocks } from './loan-collection';

// Échéance des prêts du temple (#725), contre Supabase local. Chaque test a son monde et joue des clôtures passées.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = neutralEconomy(INITIAL_CONFIG as GameConfig);
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
/** Horloge de la base, qui date les prêts (#725) : celle de sa configuration en vigueur. */
let clock = initial.clock;
let [TODAY, DUE] = [0, 0];
const LOSS = 40;
/** Prêts de 500 oboles pour 7 jours à 10 % : 1 obole d'intérêts, 501 dues. */
const [PRINCIPAL, OWED] = [500, 501];

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
  const { rows } = await sql<{ hour: number; timezone: string }>`select daily_close_hour as hour,
    timezone from game.clock_rules()`.execute(owner);
  clock = { ...clock, dailyCloseHour: rows[0]?.hour ?? 0, timezone: rows[0]?.timezone ?? 'UTC' };
  TODAY = gameDayAt(new Date(), clock);
  // Prêts empruntés aujourd'hui puis reculés de 10 jours : échus à la clôture d'il y a 3 jours.
  DUE = TODAY - 3;
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const close = (
  worldId: string,
  gameDay: number,
  steps: readonly CloseStep[] = [loanDefaultLocks, loanCollection],
  sites = initial.sites,
) =>
  runDailyClose(db, {
    worldId,
    gameDay,
    closeAt: dailyCloseAt(gameDay, clock),
    config: {
      at: async () => {
        const config: GameConfig = { ...initial, clock, sites };
        config.templeTreasury = {
          policyRateBps: 1_000,
          termDays: [7],
          principalCaps: [],
          defaultHonorLoss: LOSS,
          dishonorDays: 28,
        };
        config.honor = { min: -10_000, max: 10_000, changes: { archon_term: 0 } };
        return { ...loaded, config };
      },
    },
    steps,
    now: new Date(),
  });

/** Verse (ou retire, négatif) des oboles à la trésorerie d'une maison depuis le robinet de départ. */
const credit = (worldId: string, houseId: string, oboles: number) =>
  sql`with entry as (insert into game.ledger_entries (world_id, kind) values (${worldId}, 'test.seed') returning id)
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry.id, a.id, case when a.kind = 'house' then ${oboles}::bigint else -${oboles}::bigint end
    from entry, game.accounts a where a.world_id = ${worldId}
      and ((a.kind = 'house' and a.house_id = ${houseId}) or a.system_key = 'faucet_starting_grant')`.execute(
    owner,
  );

/**
 * Un monde à une cité ; chaque maison emprunte 500 oboles pour 7 jours comme l'écrit `loan.borrowFromTemple`, puis sa
 * trésorerie passe à `treasury` ; ses sites (`recipes`) ont dix jours. Les prêts sont ensuite reculés de dix jours,
 * gardes levées : un prêt ne naît qu'aujourd'hui.
 */
async function newWorld(houses: { treasury: number; recipes?: string[] }[]) {
  const [worldId, cityId] = [randomUUID(), randomUUID()];
  const ids = houses.map(() => randomUUID()).sort();
  const users = ids.map(() => randomUUID());
  await owner.transaction().execute(async (trx) => {
    for (const statement of [
      sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`l-${worldId.slice(0, 12)}`}, 'Prêts')`,
      sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Agora')`,
      sql`insert into auth.users (id, email) select u, u || '@example.test' from unnest(${users}::uuid[]) u`,
      sql`insert into game.houses (id, world_id, user_id, name, blazon) select h, ${worldId}, u, 'Maison ' || chr(96 + n::int),
        '{}' from unnest(${ids}::uuid[], ${users}::uuid[]) with ordinality v (h, u, n)`,
      sql`insert into game.accounts (world_id, kind, house_id) select ${worldId}, 'house', h from unnest(${ids}::uuid[]) h`,
    ])
      await statement.execute(trx);
    for (const id of ids) {
      const { rows } = await sql<{
        id: string;
      }>`with entry as (insert into game.ledger_entries (world_id, kind, meta)
          values (${worldId}, 'loan.temple_disburse', ${JSON.stringify({ houseId: id })}) returning id),
        lines as (insert into game.ledger_lines (entry_id, account_id, amount)
          select entry.id, a.id, case when a.kind = 'house' then ${PRINCIPAL}::bigint else -${PRINCIPAL}::bigint end
          from entry, game.accounts a where a.world_id = ${worldId}
            and ((a.kind = 'house' and a.house_id = ${id}) or a.system_key = 'faucet_temple_loans'))
        select id from entry`.execute(trx);
      await sql`insert into game.loans (world_id, lender, borrower_house_id, principal, rate_bps, term_days, interest,
          borrowed_day, due_day, due_at, disbursement_entry_id)
        values (${worldId}, 'temple', ${id}, ${PRINCIPAL}, 1000, 7, 1, ${TODAY}, ${TODAY + 7},
          ${dailyCloseAt(TODAY + 7, clock)}, ${rows[0]?.id})`.execute(trx);
    }
    const sites = houses.flatMap((house, index) =>
      (house.recipes ?? []).map((recipe) => [ids[index], recipe]),
    );
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`insert into game.sites (world_id, house_id, city_id, recipe_id, created_at, cycle_started_at)
      select ${worldId}, h, ${cityId}, r, now() - interval '10 days', now() - interval '9 days'
      from unnest(${sites.map((site) => site[0])}::uuid[], ${sites.map((site) => site[1])}::text[]) v (h, r)`.execute(
      trx,
    );
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
  for (const [index, id] of ids.entries())
    if ((houses[index]?.treasury ?? 0) !== PRINCIPAL)
      await credit(worldId, id, (houses[index]?.treasury ?? 0) - PRINCIPAL);
  await owner.transaction().execute(async (trx) => {
    await sql`set local session_replication_role = replica`.execute(trx);
    await sql`update game.loans set borrowed_day = borrowed_day - 10, due_day = due_day - 10,
        due_at = ${dailyCloseAt(TODAY - 3, clock)}, created_at = created_at - interval '11 days'
      where world_id = ${worldId}`.execute(trx);
  });
  return { worldId, ids };
}
type Row = { s: string };
const texts = async (query: RawBuilder<Row>) => (await query.execute(db)).rows.map((row) => row.s);
/** Par maison : état du prêt, reste dû, jour du défaut (relatif à l'échéance), trésorerie et Timè. */
const stateOf = (worldId: string) =>
  texts(sql<Row>`select o.status || ':' || o.outstanding || ':' || coalesce((o.defaulted_day - o.due_day)::text, '-')
        || ':' || a.balance || ':' || coalesce(t.honor, 0) as s
      from game.loans o join game.accounts a on a.house_id = o.borrower_house_id and a.kind = 'house'
      left join game.honor t on t.house_id = o.borrower_house_id
      where o.world_id = ${worldId} order by o.borrower_house_id`);
/** Prélèvements de chaque maison : jour (relatif à l'échéance), intérêts et principal. */
const collectionsOf = (houseId: string) =>
  texts(sql<Row>`select (r.game_day - o.due_day) || ':' || r.interest || '+' || r.principal as s
      from game.loan_repayments r join game.loans o on o.id = r.loan_id
      where r.house_id = ${houseId} and r.kind = 'collect' order by r.game_day`);
const eventsOf = async (houseId: string, type: string) =>
  (
    await sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
      where type = ${type} and payload->>'houseId' = ${houseId} order by seq`.execute(db)
  ).rows.map((row) => row.payload);
const systemOf = async (worldId: string) =>
  (
    await texts(sql<Row>`select string_agg(system_key || ':' || balance, ' ' order by system_key) as s
      from game.accounts where world_id = ${worldId} and system_key in ('faucet_temple_loans', 'sink_temple_interest')`)
  )[0];

/**
 * Un monde à une cité, sa banque et son emprunteur (#728) : le banquier verse 5 000 oboles au coffre ; l'emprunteur,
 * qui a 20 blés, emprunte 1 000 oboles pour 30 jours à 12 % (10 d'intérêts, 1 010 dus) gagés sur ses 20 blés, comme
 * l'écrit `loan.acceptOffer`, puis sa trésorerie passe à `treasury`. Le prêt est ensuite reculé pour échoir il y a
 * 3 jours, gardes levées.
 */
async function newBankWorld(treasury: number) {
  const [worldId, cityId, banker, borrower] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  await owner.transaction().execute(async (trx) => {
    for (const statement of [
      sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`b-${worldId.slice(0, 12)}`}, 'Banque')`,
      sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Agora')`,
      sql`insert into auth.users (id, email) select u, u || '@example.test' from unnest(${[banker, borrower]}::uuid[]) u`,
      sql`insert into game.houses (id, world_id, user_id, name, blazon) select h, ${worldId}, h, 'Maison ' || chr(96 + n::int),
        '{}' from unnest(${[banker, borrower]}::uuid[]) with ordinality v (h, n)`,
      sql`insert into game.citizenships (house_id, city_id) select h, ${cityId} from unnest(${[banker, borrower]}::uuid[]) h`,
      sql`insert into game.accounts (world_id, kind, house_id) select ${worldId}, 'house', h
        from unnest(${[banker, borrower]}::uuid[]) h`,
      sql`insert into game.banks (world_id, city_id, house_id, name, deposit_rate_bps, loan_rate_bps, charter_fee)
        values (${worldId}, ${cityId}, ${banker}, 'Trapeza Agora', 0, 0, 0)`,
      sql`insert into game.inventories (world_id, house_id, city_id, good_id) values (${worldId}, ${borrower}, ${cityId}, 'wheat')`,
      sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
        select ${worldId}, 'wheat', 20, 'production', id, 'test' from game.inventories where house_id = ${borrower}`,
    ])
      await statement.execute(trx);
  });
  await credit(worldId, banker, 5_000);
  const bankId =
    (
      await ownerTexts(sql<Row>`select id::text as s from game.banks where house_id = ${banker}`)
    )[0] ?? '';
  const post = (kind: string, from: string, to: string, amount: number) =>
    sql`with entry as (insert into game.ledger_entries (world_id, kind, meta)
        values (${worldId}, ${kind}, ${JSON.stringify({ bankId })}) returning id)
      insert into game.ledger_lines (entry_id, account_id, amount)
      select entry.id, a.id, case when a.id = ${to}::uuid then ${amount}::bigint else -${amount}::bigint end
      from entry, game.accounts a where a.id in (${from}::uuid, ${to}::uuid) returning entry_id`;
  const account = async (houseId: string | null) =>
    (
      await ownerTexts(sql<Row>`select id::text as s from game.accounts
        where ${houseId === null ? sql`bank_id = ${bankId}` : sql`kind = 'house' and house_id = ${houseId}`}`)
    )[0] ?? '';
  const [vault, bankerCash, borrowerCash] = [
    await account(null),
    await account(banker),
    await account(borrower),
  ];
  await owner.transaction().execute(async (trx) => {
    await post('bank.capital_in', bankerCash, vault, 5_000).execute(trx);
    const offer =
      await sql<Row>`insert into game.bank_loan_offers (world_id, bank_id, borrower_house_id, principal,
        rate_bps, term_days, collateral_kind, collateral_city_id, collateral_good_id, collateral_quantity)
      values (${worldId}, ${bankId}, ${borrower}, 1000, 1200, 30, 'stock', ${cityId}, 'wheat', 20) returning id::text as s`.execute(
        trx,
      );
    const entry = await post('bank.loan_disburse', vault, borrowerCash, 1_000).execute(trx);
    await sql`insert into game.loans (world_id, lender, borrower_house_id, principal, rate_bps, term_days, interest,
        borrowed_day, due_day, due_at, disbursement_entry_id, bank_id, offer_id)
      values (${worldId}, 'bank', ${borrower}, 1000, 1200, 30, 10, ${TODAY}, ${TODAY + 30},
        ${dailyCloseAt(TODAY + 30, clock)}, ${(entry.rows[0] as { entry_id: string }).entry_id}, ${bankId},
        ${offer.rows[0]?.s})`.execute(trx);
  });
  if (treasury !== 1_000) await credit(worldId, borrower, treasury - 1_000);
  await owner.transaction().execute(async (trx) => {
    await sql`set local session_replication_role = replica`.execute(trx);
    await sql`update game.loans set borrowed_day = borrowed_day - 33, due_day = due_day - 33,
        due_at = ${dailyCloseAt(TODAY - 3, clock)}, created_at = created_at - interval '34 days'
      where world_id = ${worldId}`.execute(trx);
  });
  return { worldId, bankId, borrower };
}
/** Lu par le propriétaire : le service ne voit pas les coffres. */
const ownerTexts = async (query: RawBuilder<Row>) =>
  (await query.execute(owner)).rows.map((row) => row.s);
const vaultOf = async (bankId: string) =>
  Number(
    (
      await ownerTexts(
        sql<Row>`select balance::text as s from game.accounts where bank_id = ${bankId}`,
      )
    )[0],
  );

describe('échéance des prêts du temple (#725)', () => {
  it('payée, payée en partie puis soldée aux clôtures suivantes, défaut sans rien ; Timè perdue une fois ; rejouée, rien deux fois', async () => {
    // a : 1 000 pour 501 dus ; b : 100 ; c : rien.
    const { worldId, ids } = await newWorld([
      { treasury: 1_000 },
      { treasury: 100 },
      { treasury: 0 },
    ]);
    const [a, b, c] = ids as [string, string, string];
    expect((await close(worldId, DUE - 1)).summary).toEqual({
      loanDefaultLocks: { houses: 0 },
      loanCollection: { collected: 0, collectedOboles: 0, defaulted: 0, honorLost: 0 },
    });
    expect((await close(worldId, DUE)).summary).toEqual({
      loanDefaultLocks: { houses: 3 },
      loanCollection: {
        collected: 2,
        collectedOboles: OWED + 100,
        defaulted: 2,
        honorLost: 2 * LOSS,
      },
    });
    expect(await stateOf(worldId)).toEqual([
      `repaid:0:-:${1_000 - OWED}:0`,
      `defaulted:${OWED - 100}:0:0:-${LOSS}`,
      `defaulted:${OWED}:0:0:-${LOSS}`,
    ]);
    // Intérêts d'abord, au puits ; le principal recrédite le robinet, qui ne compte en net que le principal encore dû.
    expect(await systemOf(worldId)).toBe(
      `faucet_temple_loans:-${3 * PRINCIPAL - PRINCIPAL - 99} sink_temple_interest:2`,
    );
    expect(await collectionsOf(b)).toEqual(['0:1+99']);
    const brief = (events: Record<string, unknown>[]) =>
      events.map((e) => [e['outstanding'], e['status'] ?? e['honorLost'], e['gameDay']]);
    expect(brief(await eventsOf(a, 'LoanCollected'))).toEqual([[0, 'repaid', DUE]]);
    // Prélèvement partiel à l'échéance : le prêt passe en défaut aussitôt après.
    expect(brief(await eventsOf(b, 'LoanCollected'))).toEqual([[OWED - 100, 'defaulted', DUE]]);
    expect(brief(await eventsOf(c, 'LoanDefaulted'))).toEqual([[OWED, LOSS, DUE]]);
    expect((await close(worldId, DUE)).status).toBe('skipped');
    expect(await collectionsOf(b)).toEqual(['0:1+99']);

    // Les clôtures suivantes prennent ce que la trésorerie couvre, sans intérêt de plus ni nouvelle perte de Timè.
    await credit(worldId, b, 250);
    expect((await close(worldId, DUE + 1)).summary['loanCollection']).toEqual({
      collected: 1,
      collectedOboles: 250,
      defaulted: 0,
      honorLost: 0,
    });
    await credit(worldId, b, 1_000);
    await close(worldId, DUE + 2);
    expect(await collectionsOf(b)).toEqual(['0:1+99', '1:0+250', '2:0+151']);
    expect(await stateOf(worldId)).toEqual([
      `repaid:0:-:${1_000 - OWED}:0`,
      `repaid:0:0:${1_000 - 151}:-${LOSS}`,
      `defaulted:${OWED}:0:0:-${LOSS}`,
    ]);
    // Une seule perte de Timè et un seul défaut pour b, au jour de l'échéance.
    expect(brief(await eventsOf(b, 'LoanDefaulted'))).toEqual([[OWED - 100, LOSS, DUE]]);
    expect(await systemOf(worldId)).toBe(
      `faucet_temple_loans:-${PRINCIPAL} sink_temple_interest:2`,
    );
  });

  it('dans la clôture entière, le prélèvement passe avant l’entretien : payé, le prêt laisse le site à l’arrêt', async () => {
    // Champ de blé : 30 oboles d'entretien par jour. 501 dus et 29 de plus en trésorerie : le prêt est soldé, le site s'arrête.
    const sites = {
      ...initial.sites,
      upkeep: {
        coefficientBps: 10_000,
        dailyOboles: { ...initial.sites.upkeep.dailyOboles, field: 30 },
      },
    };
    const { worldId, ids } = await newWorld([{ treasury: OWED + 29, recipes: ['grow_wheat'] }]);
    const outcome = await close(worldId, DUE, CLOSE_STEPS, sites);
    expect(outcome.summary['loanCollection']).toMatchObject({
      collected: 1,
      collectedOboles: OWED,
      defaulted: 0,
    });
    expect(await stateOf(worldId)).toEqual(['repaid:0:-:29:0']);
    const { rows } = await sql<{
      halted: boolean;
    }>`select halted_at is not null as halted from game.sites
      where house_id = ${ids[0]}`.execute(db);
    expect(rows).toEqual([{ halted: true }]);
  });

  it('un remboursement qui tient l’agora : la clôture l’attend, puis ne prend que ce qui reste', async () => {
    const { worldId, ids } = await newWorld([{ treasury: PRINCIPAL }]);
    const houseId = ids[0] ?? '';
    // Remboursement de 300 comme l'écrit `loan.repay` : agora, écriture, remboursement ; laissé ouvert.
    const trx = await db.startTransaction().execute();
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    const { rows } = await sql<{
      id: string;
    }>`with entry as (insert into game.ledger_entries (world_id, kind, meta)
        values (${worldId}, 'loan.repay', (select jsonb_build_object('loanId', id) from game.loans where borrower_house_id = ${houseId}))
        returning id),
      lines as (insert into game.ledger_lines (entry_id, account_id, amount)
        select entry.id, a.id, case when a.kind = 'house' then -300 when a.system_key = 'sink_temple_interest' then 1 else 299 end
        from entry, game.accounts a where a.world_id = ${worldId} and ((a.kind = 'house' and a.house_id = ${houseId})
          or a.system_key in ('sink_temple_interest', 'faucet_temple_loans')))
      select id from entry`.execute(trx);
    await sql`insert into game.loan_repayments (world_id, loan_id, house_id, interest, principal, game_day, ledger_entry_id)
      select ${worldId}, id, ${houseId}, 1, 299, ${TODAY}, ${rows[0]?.id} from game.loans where borrower_house_id = ${houseId}`.execute(
      trx,
    );
    const closing = close(worldId, DUE);
    for (let attempt = 0; ; attempt += 1) {
      const { rows: waiting } = await sql<{
        n: number;
      }>`select count(*)::int as n from pg_locks where not granted`.execute(owner);
      if ((waiting[0]?.n ?? 0) > 0) break;
      if (attempt > 200) throw new Error('the close is not waiting');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await trx.commit().execute();
    expect((await closing).summary['loanCollection']).toEqual({
      collected: 1,
      collectedOboles: 200,
      defaulted: 1,
      honorLost: LOSS,
    });
    expect(await collectionsOf(houseId)).toEqual(['0:0+200']);
    expect(await stateOf(worldId)).toEqual([`defaulted:1:0:0:-${LOSS}`]);
  });
});

describe('échéance des prêts de banque (#728)', () => {
  it('prélevée pour le coffre, sans défaut ni Timè perdue ; soldée, la garantie se libère ; rejouée, rien deux fois', async () => {
    const { worldId, bankId, borrower } = await newBankWorld(300);
    const stockOf = async () =>
      (
        await texts(sql<Row>`select quantity || '/' || reserved as s from game.inventories
          where house_id = ${borrower} and good_id = 'wheat'`)
      )[0];
    expect([await vaultOf(bankId), await stockOf()]).toEqual([4_000, '20/20']);
    expect((await close(worldId, DUE)).summary).toEqual({
      loanDefaultLocks: { houses: 0 },
      loanCollection: { collected: 1, collectedOboles: 300, defaulted: 0, honorLost: 0 },
    });
    // Intérêts d'abord ; le reste dû reste dû, en cours, et le stock reste gagé.
    expect(await stateOf(worldId)).toEqual(['active:710:-:0:0']);
    expect(await collectionsOf(borrower)).toEqual(['0:10+290']);
    expect([await vaultOf(bankId), await stockOf()]).toEqual([4_300, '20/20']);
    expect(await eventsOf(borrower, 'LoanDefaulted')).toEqual([]);
    expect((await eventsOf(borrower, 'LoanCollected'))[0]).toMatchObject({
      status: 'active',
      outstanding: 710,
    });
    expect((await close(worldId, DUE)).status).toBe('skipped');
    await credit(worldId, borrower, 800);
    await close(worldId, DUE + 1);
    expect(await stateOf(worldId)).toEqual(['repaid:0:-:90:0']);
    expect([await vaultOf(bankId), await stockOf()]).toEqual([5_010, '20/0']);
    // Le temple n'a rien pris : ni intérêts au puits, ni principal au robinet.
    expect(await systemOf(worldId)).toBe('faucet_temple_loans:0 sink_temple_interest:0');
    const lines =
      await ownerTexts(sql<Row>`select string_agg(case when a.bank_id is not null then 'vault' else a.kind end
        || ':' || l.amount, ' ' order by e.created_at, l.amount) as s from game.ledger_entries e
      join game.ledger_lines l on l.entry_id = e.id join game.accounts a on a.id = l.account_id
      where e.world_id = ${worldId} and e.kind = 'bank.loan_collect'`);
    expect(lines).toEqual(['house:-300 vault:300 house:-710 vault:710']);
  });
});

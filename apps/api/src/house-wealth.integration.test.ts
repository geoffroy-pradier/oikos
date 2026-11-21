import { randomUUID } from 'node:crypto';
import { ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import {
  createRng,
  dailyCloseAt,
  houseWealth,
  splitLoanRepayment,
  templeLoanInterest,
  type Rng,
} from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';

// Fortune d'une maison (#718) : la fonction de la base `game.house_wealth` et la fonction pure `houseWealth`
// rendent la même valeur sur les mêmes données, contre Supabase local. Chaque essai fonde son propre monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const service = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
// La base date l'emprunt à l'horloge de sa configuration en vigueur (#725) : celle de la configuration initiale.
beforeAll(() => ensureInitialConfig(service, INITIAL_CONFIG));
afterAll(() => Promise.all([service.destroy(), owner.destroy()]));

const GOODS = ['wheat', 'olives', 'fish', 'salt'] as const;
const [RATE, TERM] = [1_000, 7];
const CITIES = 2;
type Stock = { city: number; good: string; quantity: number; consumed: boolean };
type Scenario = {
  houses: {
    grant: number;
    pending: [number, number] | null;
    stocks: Stock[];
    sails: boolean;
    /** Prêt du temple (#724) : principal, et oboles remboursées (zéro, une part, ou tout). */
    loan: [number, number] | null;
    /** Banque (#726) : droit de fondation détruit et capital versé au coffre, que la fortune compte. */
    bank: [number, number] | null;
    /** Dépôt (#727) dans la banque d'une autre maison du scénario : sa banque, le montant déposé, puis retiré. */
    deposit: [number, number, number] | null;
  }[];
  observed: { city: number; good: string; price: number }[];
};
/** Couples (cité, bien) distincts, tirés dans l'ordre. */
function pairs(rng: Rng, max: number) {
  const all = Array.from({ length: CITIES }, (_, city) =>
    GOODS.map((good) => ({ city, good })),
  ).flat();
  return all.filter(() => rng.next() < max / all.length);
}
/**
 * Scénario tiré d'une graine : une à cinq maisons, chacune une dotation (parfois nulle), parfois un achat en attente
 * (prix × quantité au séquestre), des stocks dans les deux cités, parfois vidés ; quelques prix observés. Une
 * maison sur deux a un navire en mer de la cité 0 vers la cité 1, chargé de la moitié de chaque stock non vidé de la
 * cité 0 (sur lest sans stock) : sa cargaison compte au prix de la cité 1 (#719). Une maison sur deux a emprunté au
 * temple, à 10 % pour 7 jours, et en a remboursé rien, une part ou tout : son reste dû se déduit (#724). Une maison sur
 * deux a fondé sa banque, droit parfois nul, capital parfois nul ou toute sa trésorerie : son coffre compte (#726).
 */
function scenario(seed: string): Scenario {
  const rng = createRng(seed);
  const amount = () => (rng.next() < 0.2 ? 0 : rng.int(1, 10_000_000));
  const houses = Array.from({ length: rng.int(1, 5) }, () => ({
    grant: amount(),
    pending: rng.next() < 0.5 ? ([rng.int(1, 500), rng.int(1, 50)] as [number, number]) : null,
    stocks: pairs(rng, 4).map((pair) => ({
      ...pair,
      quantity: rng.int(1, 1_000_000),
      consumed: rng.next() < 0.2,
    })),
    sails: rng.next() < 0.5,
    loan: null as [number, number] | null,
    bank: null as [number, number] | null,
    deposit: null as [number, number, number] | null,
  }));
  for (const house of houses) {
    if (rng.next() < 0.5) continue;
    const principal = rng.int(1, 1_000_000);
    const owed = principal + Number(templeLoanInterest(BigInt(principal), RATE, TERM));
    // Tout rembourser demande que la dotation couvre les intérêts ; sinon, au plus le principal.
    const roll = rng.next();
    const repaid =
      roll < 0.3 ? 0 : roll < 0.6 && house.grant >= owed - principal ? owed : rng.int(1, principal);
    house.loan = [principal, repaid];
  }
  const observed = pairs(rng, 4).map((pair) => ({ ...pair, price: rng.int(1, 100_000) }));
  // Tirée après le reste, pour garder les scénarios d'avant #726.
  for (const house of houses) {
    if (rng.next() < 0.5) continue;
    const cash = house.grant + (house.loan ? house.loan[0] - house.loan[1] : 0);
    const fee = rng.next() < 0.3 ? 0 : rng.int(0, cash);
    const roll = rng.next();
    house.bank = [fee, roll < 0.2 ? 0 : roll < 0.4 ? cash - fee : rng.int(0, cash - fee)];
  }
  // Tirée après le reste, pour garder les scénarios d'avant #727 : une maison sur deux dépose dans la banque d'une autre
  // ce que sa trésorerie couvre, parfois tout, et en retire parfois une part ou tout.
  for (const [index, house] of houses.entries()) {
    const banks = houses.flatMap((other, at) => (at !== index && other.bank ? [at] : []));
    const cash =
      house.grant +
      (house.loan ? house.loan[0] - house.loan[1] : 0) -
      (house.bank ? house.bank[0] + house.bank[1] : 0);
    if (banks.length === 0 || cash <= 0 || rng.next() < 0.5) continue;
    const amount = rng.next() < 0.2 ? cash : rng.int(1, cash);
    const roll = rng.next();
    house.deposit = [
      banks[rng.int(0, banks.length - 1)] ?? -1,
      amount,
      roll < 0.4 ? 0 : roll < 0.6 ? amount : rng.int(0, amount),
    ];
  }
  return { houses, observed };
}

it('la base et la simulation rendent la même fortune, stocks sans prix comptés à part, cargaisons en mer, coffres et dépôts compris, dettes déduites', async () => {
  let [atSea, borrowed, repaidLoans, banked, deposited] = [0, 0, 0, 0, 0];
  for (let run = 0; run < 15; run += 1) {
    const { houses, observed } = scenario(`house-wealth-${run}`);
    const world = randomUUID();
    const cities = Array.from({ length: CITIES }, () => randomUUID());
    const ids = houses.map(() => randomUUID());
    const bankIds: (string | null)[] = houses.map(() => null);
    await owner.transaction().execute(async (trx) => {
      // Jour de jeu et horloge de la base, que la base vérifie à l'emprunt (#725).
      const { rows: clocks } = await sql<{
        today: number;
        dailyCloseHour: number;
        timezone: string;
      }>`
        select game.game_day_at(now()) as today, daily_close_hour as "dailyCloseHour", timezone
        from game.clock_rules()`.execute(trx);
      const { today, ...clock } = clocks[0] ?? { today: 0, dailyCloseHour: 0, timezone: 'UTC' };
      const slug = `w${world.slice(0, 8)}`;
      await sql`insert into game.worlds (id, slug, name) values (${world}, ${slug}, 'Fortune')`.execute(
        trx,
      );
      for (const [index, city] of cities.entries())
        await sql`insert into game.cities (id, world_id, slug, name)
          values (${city}, ${world}, ${`c${index}`}, ${`Cité ${index}`})`.execute(trx);
      const faucet = sql`(select id from game.accounts
        where world_id = ${world} and system_key = 'faucet_starting_grant')`;
      for (const [index, h] of houses.entries()) {
        const [id, user] = [ids[index] ?? '', randomUUID()];
        await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
          trx,
        );
        const name = `Maison ${String.fromCharCode(97 + index)}`;
        await sql`insert into game.houses (id, world_id, user_id, name, blazon)
          values (${id}, ${world}, ${user}, ${name}, '{}')`.execute(trx);
        await sql`insert into game.accounts (world_id, kind, house_id)
          values (${world}, 'house', ${id}), (${world}, 'escrow', ${id})`.execute(trx);
        const held = h.pending ? h.pending[0] * h.pending[1] : 0;
        const post = async (kind: string, lines: [unknown, number][], meta = {}) => {
          const { rows } = await sql<{
            id: string;
          }>`insert into game.ledger_entries (world_id, kind, meta)
            values (${world}, ${kind}, ${JSON.stringify(meta)}) returning id`.execute(trx);
          for (const [account, n] of lines)
            if (n !== 0)
              await sql`insert into game.ledger_lines (entry_id, account_id, amount)
                values (${rows[0]?.id}, ${account}, ${n})`.execute(trx);
          return rows[0]?.id ?? '';
        };
        const system = (key: string) =>
          sql`(select id from game.accounts where world_id = ${world} and system_key = ${key})`;
        const account = (kind: string) =>
          sql`(select id from game.accounts where house_id = ${id} and kind = ${kind})`;
        const grant = h.grant + held;
        if (grant > 0)
          await post('house.starting_grant', [
            [faucet, -grant],
            [account('house'), grant],
          ]);
        if (h.loan) {
          // Emprunt et remboursement comme `loan.borrowFromTemple` et `loan.repay` les écrivent.
          const [principal, repaid] = h.loan;
          const interest = templeLoanInterest(BigInt(principal), RATE, TERM);
          const disbursed = await post('loan.temple_disburse', [
            [system('faucet_temple_loans'), -principal],
            [account('house'), principal],
          ]);
          const { rows: loan } = await sql<{ id: string }>`insert into game.loans (world_id, lender,
              borrower_house_id, principal, rate_bps, term_days, interest, borrowed_day, due_day, due_at,
              disbursement_entry_id)
            values (${world}, 'temple', ${id}, ${principal}, ${RATE}, ${TERM}, ${interest}, ${today},
              ${today + TERM}, ${dailyCloseAt(today + TERM, clock)}, ${disbursed}) returning id`.execute(
            trx,
          );
          if (repaid > 0) {
            const split = splitLoanRepayment(BigInt(repaid), interest);
            const entry = await post(
              'loan.repay',
              [
                [account('house'), -repaid],
                [system('sink_temple_interest'), Number(split.interest)],
                [system('faucet_temple_loans'), Number(split.principal)],
              ],
              { loanId: loan[0]?.id },
            );
            await sql`insert into game.loan_repayments (world_id, loan_id, house_id, interest, principal,
                game_day, ledger_entry_id)
              values (${world}, ${loan[0]?.id}, ${id}, ${split.interest}, ${split.principal}, ${today}, ${entry})`.execute(
              trx,
            );
          }
        }
        if (h.pending) {
          const [price, quantity] = h.pending;
          await sql`insert into game.orders (world_id, city_id, house_id, good_id, side, price, quantity, remaining)
            values (${world}, ${cities[0]}, ${id}, 'wheat', 'buy', ${price}, ${quantity}, ${quantity})`.execute(
            trx,
          );
          await post('market.escrow_hold', [
            [account('house'), -held],
            [account('escrow'), held],
          ]);
        }
        if (h.bank) {
          // Fondation comme `bank.found` l'écrit : la banque, dans la cité de la maison, son droit, son capital.
          const [fee, capital] = h.bank;
          await sql`insert into game.citizenships (house_id, city_id) values (${id}, ${cities[0]})`.execute(
            trx,
          );
          const { rows: bank } = await sql<{
            id: string;
          }>`insert into game.banks (world_id, city_id, house_id, name,
              deposit_rate_bps, loan_rate_bps, charter_fee)
            values (${world}, ${cities[0]}, ${id}, ${`Trapeza ${name.slice(-1)}`}, 0, 0, ${fee}) returning id`.execute(
            trx,
          );
          const bankId = bank[0]?.id;
          const vault = sql`(select id from game.accounts where bank_id = ${bankId})`;
          if (fee > 0)
            await post(
              'bank.charter',
              [
                [account('house'), -fee],
                [system('sink_bank_charter'), fee],
              ],
              { bankId },
            );
          if (capital > 0)
            await post(
              'bank.capital_in',
              [
                [vault, capital],
                [account('house'), -capital],
              ],
              { bankId },
            );
          bankIds[index] = bankId ?? null;
          banked += 1;
        }
        const loads: [inventory: string, good: string, quantity: number][] = [];
        for (const s of h.stocks) {
          const { rows } = await sql<{
            id: string;
          }>`insert into game.inventories (world_id, house_id, city_id, good_id)
            values (${world}, ${id}, ${cities[s.city]}, ${s.good}) returning id`.execute(trx);
          await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
            values (${world}, ${s.good}, ${s.quantity}, 'production', ${rows[0]?.id}, 'site.collect')`.execute(
            trx,
          );
          // Un stock vidé reste une ligne, de quantité nulle : il ne compte pas, même sans prix.
          if (s.consumed)
            await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind)
              select ${world}, good_id, quantity, id, 'consumption', 'npc.consume'
              from game.inventories where id = ${rows[0]?.id}`.execute(trx);
          else if (h.sails && s.city === 0)
            loads.push([rows[0]?.id ?? '', s.good, Math.ceil(s.quantity / 2)]);
        }
        if (h.sails) {
          // Départ comme `voyage.depart` l'écrit : voyage en mer, cargaison chargée, navire qui quitte le quai.
          const { rows: ship } = await sql<{
            id: string;
          }>`insert into game.ships (world_id, house_id, class_id, docked_city_id)
            values (${world}, ${id}, 'coaster', ${cities[0]}) returning id`.execute(trx);
          const { rows: voyage } = await sql<{ id: string }>`insert into game.voyages
            (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at)
            values (${world}, ${id}, ${ship[0]?.id}, ${cities[0]}, ${cities[1]}, now() + interval '1 hour') returning id`.execute(
            trx,
          );
          for (const [inventory, good, quantity] of loads) {
            await sql`insert into game.voyage_cargo (voyage_id, world_id, good_id, quantity)
              values (${voyage[0]?.id}, ${world}, ${good}, ${quantity})`.execute(trx);
            await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind, voyage_id)
              values (${world}, ${good}, ${quantity}, ${inventory}, 'in_transit', 'voyage.departure', ${voyage[0]?.id})`.execute(
              trx,
            );
          }
          await sql`update game.ships set docked_city_id = null where id = ${ship[0]?.id}`.execute(
            trx,
          );
        }
      }
      // Dépôts et retraits comme `bank.deposit` et `bank.withdraw` les écrivent, une fois toutes les banques fondées.
      for (const [index, h] of houses.entries()) {
        if (!h.deposit) continue;
        const [at, amount, withdrawn] = h.deposit;
        const [id, bankId] = [ids[index] ?? '', bankIds[at] ?? ''];
        const treasury = sql`(select id from game.accounts where house_id = ${id} and kind = 'house')`;
        const vault = sql`(select id from game.accounts where bank_id = ${bankId})`;
        const { rows: deposit } = await sql<{
          id: string;
        }>`insert into game.bank_deposits (world_id, bank_id, house_id)
          values (${world}, ${bankId}, ${id}) returning id`.execute(trx);
        for (const [kind, n] of [
          ['deposit', amount],
          ['withdraw', withdrawn],
        ] as const) {
          if (n === 0) continue;
          const { rows: entry } = await sql<{
            id: string;
          }>`insert into game.ledger_entries (world_id, kind, meta)
            values (${world}, ${`bank.${kind}`}, ${JSON.stringify({ bankId })}) returning id`.execute(
            trx,
          );
          const [from, to] = kind === 'deposit' ? [treasury, vault] : [vault, treasury];
          await sql`insert into game.ledger_lines (entry_id, account_id, amount)
            values (${entry[0]?.id}, ${to}, ${n}), (${entry[0]?.id}, ${from}, ${-n})`.execute(trx);
          await sql`insert into game.bank_deposit_movements (world_id, deposit_id, bank_id, house_id, kind, amount,
              ledger_entry_id)
            values (${world}, ${deposit[0]?.id}, ${bankId}, ${id}, ${kind}, ${n}, ${entry[0]?.id})`.execute(
            trx,
          );
        }
        deposited += 1;
      }
      for (const p of observed)
        await sql`insert into game.observed_prices (world_id, city_id, good_id, price, volume, window_seconds, observed_at)
          values (${world}, ${cities[p.city]}, ${p.good}, ${p.price}, 1, 86400, now())`.execute(
          trx,
        );
    });

    // Données lues telles qu'en base, puis données à la fonction pure.
    const { rows: balances } = await sql<{ house_id: string; kind: string; balance: string }>`
      select house_id, kind, balance::text from game.accounts where world_id = ${world}
        and house_id is not null`.execute(owner);
    const { rows: stocks } = await sql<{
      house_id: string;
      quantity: string;
      price: string | null;
    }>`
      select i.house_id, i.quantity::text, p.price::text from game.inventories i
      left join game.observed_prices p on p.city_id = i.city_id and p.good_id = i.good_id
      where i.world_id = ${world}`.execute(owner);
    // Cargaisons en mer, au prix observé de la cité d'arrivée.
    const { rows: cargo } = await sql<{ house_id: string; quantity: string; price: string | null }>`
      select v.house_id, k.quantity::text, p.price::text from game.voyages v
      join game.voyage_cargo k on k.voyage_id = v.id
      left join game.observed_prices p on p.city_id = v.to_city_id and p.good_id = k.good_id
      where v.world_id = ${world} and v.arrived_at is null`.execute(owner);
    atSea += cargo.length;
    // Dette attendue tirée du scénario, pas de la base : principal + intérêts − remboursé.
    const debtOf = (loan: [number, number] | null) =>
      loan
        ? BigInt(loan[0]) + templeLoanInterest(BigInt(loan[0]), RATE, TERM) - BigInt(loan[1])
        : 0n;
    const loaned = houses.filter((h) => h.loan);
    borrowed += loaned.length;
    repaidLoans += loaned.filter((h) => debtOf(h.loan) === 0n).length;
    const { rows: actual } = await sql<{
      house_id: string;
      treasury: string;
      escrow: string;
      stock_value: string;
      unpriced_stocks: number;
      wealth: string;
    }>`select house_id, treasury::text, escrow::text, stock_value::text, unpriced_stocks, wealth::text
      from game.house_wealth(${world})`.execute(service);
    const balance = (id: string, kind: string) =>
      BigInt(balances.find((b) => b.house_id === id && b.kind === kind)?.balance ?? 0);
    expect(actual.map((row) => row.house_id).sort()).toEqual([...ids].sort());
    for (const [index, id] of ids.entries()) {
      // Les soldes lus sont bien ceux du scénario : dotation, et prix retenu de l'achat en attente.
      const pending = houses[index]?.pending;
      const [principal, repaid] = houses[index]?.loan ?? [0, 0];
      const [fee, capital] = houses[index]?.bank ?? [0, 0];
      const [, put, taken] = houses[index]?.deposit ?? [0, 0, 0];
      expect(balance(id, 'house')).toBe(
        BigInt((houses[index]?.grant ?? -1) + principal - repaid - fee - capital - put + taken),
      );
      expect(balance(id, 'escrow')).toBe(BigInt(pending ? pending[0] * pending[1] : 0));
      const expected = houseWealth({
        treasury: balance(id, 'house'),
        escrow: balance(id, 'escrow'),
        stocks: [...stocks, ...cargo]
          .filter((s) => s.house_id === id)
          .map((s) => ({
            quantity: BigInt(s.quantity),
            unitPrice: s.price === null ? null : BigInt(s.price),
          })),
        debt: debtOf(houses[index]?.loan ?? null),
        // Le coffre net des dépôts que la banque doit : son capital, les dépôts reçus s'y annulant.
        vault: BigInt(capital),
        deposits: BigInt(put - taken),
      });
      const row = actual.find((r) => r.house_id === id);
      expect({
        treasury: BigInt(row?.treasury ?? -1),
        escrow: BigInt(row?.escrow ?? -1),
        stockValue: BigInt(row?.stock_value ?? -1),
        unpricedStocks: row?.unpriced_stocks,
        debt: expected.debt,
        vault: expected.vault,
        deposits: expected.deposits,
        wealth: BigInt(row?.wealth ?? -1),
      }).toEqual(expected);
    }
  }
  // Des cargaisons sont bien en mer dans ces scénarios : la branche « en mer » est comparée.
  expect(atSea).toBeGreaterThan(5);
  // Des prêts sont en cours et d'autres remboursés : la dette déduite et la dette éteinte sont comparées.
  expect(borrowed - repaidLoans).toBeGreaterThan(3);
  expect(repaidLoans).toBeGreaterThan(0);
  // Des banques sont fondées : le coffre compté par la base est comparé.
  expect(banked).toBeGreaterThan(3);
  // Des dépôts sont tenus : la créance du déposant et la dette de la banque sont comparées.
  expect(deposited).toBeGreaterThan(3);
});

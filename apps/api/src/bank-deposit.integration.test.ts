import { randomUUID } from 'node:crypto';
import type { GameConfig } from '@oikos/config';
import { bankRequiredReserve } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  balanceOf,
  db,
  ELAIA,
  eventsOf,
  fund,
  GRANT,
  KALLISTE,
  newPlayer,
  owner,
  send,
} from './property.integration-fixtures';
import { appWithConfig, type App } from './voyage.integration-fixtures';

// Dépôts dans les banques de joueurs (#727), contre Supabase local : capital minimal de 1 500, réserve de 20 % des
// dépôts, taux de dépôt de 1 à 10 % l'an (la banque fondée affiche 1 %).
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
type Rules = NonNullable<GameConfig['banks']>;
const RULES: Rules = {
  charterFeeOboles: 0,
  minCapitalOboles: 1_500,
  reserveRatioBps: 2_000,
  depositRateBps: { min: 100, max: 1_000 },
  loanRateBps: { min: 300, max: 5_000 },
};
const withRules = (rules: Rules | null): App =>
  appWithConfig((config) => {
    const next: GameConfig = { ...config };
    if (rules) next.banks = rules;
    else delete next.banks;
    return next;
  });
const app = withRules(RULES);
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;
const freshName = () => `Trapeza ${[...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('')}`;
/** Une banque fondée par une maison nouvelle de Kallistè, avec `capital` oboles au coffre. */
async function newBank(capital = 1_500, via = app, city: string = KALLISTE) {
  const banker = await newPlayer(city);
  if (capital > 0) await fund(banker.houseId, capital);
  const founded = await send(
    banker.user,
    'bank.found',
    { name: freshName(), capital, expectedCharterFee: 0 },
    undefined,
    via,
  );
  return { ...banker, bankId: founded.body.data.bankId as string };
}
const deposit = (
  user: string,
  bankId: string,
  amount: number,
  rate = 100,
  key?: string,
  via = app,
) => send(user, 'bank.deposit', { bankId, amount, expectedRateBps: rate }, key, via);
const withdraw = (user: string, bankId: string, amount: number, via = app) =>
  send(user, 'bank.withdraw', { bankId, amount }, undefined, via);
const moveCapital = (user: string, direction: 'in' | 'out', amount: number) =>
  send(user, 'bank.moveCapital', { direction, amount }, undefined, app);
/** Coffre d'une banque, lu par le propriétaire : le service ne voit pas les coffres. */
const vaultOf = async (bankId: string) =>
  Number(
    (
      await sql<{
        balance: string;
      }>`select balance from game.accounts where bank_id = ${bankId}`.execute(owner)
    ).rows[0]?.balance,
  );
/** Solde du dépôt d'une maison dans une banque ; `null` sans dépôt. */
const heldBy = async (houseId: string, bankId: string) => {
  const { rows } = await sql<{ balance: string }>`select balance from game.bank_deposits
    where house_id = ${houseId} and bank_id = ${bankId}`.execute(owner);
  return rows[0] ? Number(rows[0].balance) : null;
};
/** Écritures de dépôt et de retrait de la banque : nature, compte (`house` ou `vault`) et montant. */
const linesOf = async (bankId: string) =>
  (
    await sql<{
      line: string;
    }>`select e.kind || ':' || case when a.bank_id is not null then 'vault' else a.kind end
        || ':' || l.amount as line
      from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
      join game.accounts a on a.id = l.account_id
      where e.meta ->> 'bankId' = ${bankId} and e.kind in ('bank.deposit', 'bank.withdraw')
      order by e.created_at, e.id, l.amount`.execute(owner)
  ).rows.map((row) => row.line);

describe('bank.deposit et bank.withdraw', () => {
  it('la monnaie passe de la trésorerie au coffre et revient, la créance suit ; rejouable', async () => {
    const bank = await newBank();
    const player = await newPlayer(ELAIA);
    const key = randomUUID();
    const done = await deposit(player.user, bank.bankId, 1_000, 100, key);
    expect(done.status).toBe(200);
    const depositId = done.body.data.depositId as string;
    expect(done.body.data).toEqual({
      bankId: bank.bankId,
      depositId,
      amount: 1_000,
      balance: 1_000,
      rateBps: 100,
    });
    // Même clé : même réponse, rien de plus.
    expect(await deposit(player.user, bank.bankId, 1_000, 100, key)).toEqual(done);
    expect((await deposit(player.user, bank.bankId, 500)).body.data.balance).toBe(1_500);
    const out = await withdraw(player.user, bank.bankId, 1_200);
    expect(out.body.data).toEqual({ bankId: bank.bankId, depositId, amount: 1_200, balance: 300 });
    expect(await linesOf(bank.bankId)).toEqual([
      'bank.deposit:house:-1000',
      'bank.deposit:vault:1000',
      'bank.deposit:house:-500',
      'bank.deposit:vault:500',
      'bank.withdraw:vault:-1200',
      'bank.withdraw:house:1200',
    ]);
    expect([
      await balanceOf(player.houseId),
      await vaultOf(bank.bankId),
      await heldBy(player.houseId, bank.bankId),
    ]).toEqual([GRANT - 300, 1_800, 300]);
    expect(await eventsOf(player.houseId, 'BankDeposited')).toEqual([
      { ...done.body.data, houseId: player.houseId },
      {
        bankId: bank.bankId,
        depositId,
        amount: 500,
        balance: 1_500,
        rateBps: 100,
        houseId: player.houseId,
      },
    ]);
    expect(await eventsOf(player.houseId, 'BankWithdrawn')).toEqual([
      { ...out.body.data, houseId: player.houseId },
    ]);
    // Tout le solde, puis plus rien : le dépôt reste, à zéro.
    expect((await withdraw(player.user, bank.bankId, 300)).body.data.balance).toBe(0);
    expect(codeOf(await withdraw(player.user, bank.bankId, 1))).toBe('ABOVE_BALANCE');
    expect(await heldBy(player.houseId, bank.bankId)).toBe(0);
  });

  it('un dépôt qui passerait le solde au-delà des entiers sûrs est refusé, sans effet (DEPOSIT_LIMIT)', async () => {
    // Un monde à lui : son robinet de dotation, débiteur de près de 2^53 oboles, et ses soldes géants ne touchent pas
    // le monde partagé du jeu d'essai, dont d'autres fichiers additionnent la monnaie.
    const [world, city] = [randomUUID(), randomUUID()];
    await sql`insert into game.worlds (id, slug, name) values (${world}, ${`d-${world.slice(0, 12)}`}, 'Plafond')`.execute(
      owner,
    );
    await sql`insert into game.cities (id, world_id, slug, name)
      values (${city}, ${world}, 'plafond', 'Plafond')`.execute(owner);
    const open = withRules({ ...RULES, minCapitalOboles: 0 });
    const bank = await newBank(0, open, city);
    const player = await newPlayer(city);
    try {
      const max = Number.MAX_SAFE_INTEGER;
      // Une obole de plus que le plafond : le dernier dépôt d'une obole est refusé par le solde, pas par la trésorerie.
      await fund(player.houseId, max - GRANT + 1);
      const full = await deposit(player.user, bank.bankId, max, 100, undefined, open);
      expect(full.body.data.balance).toBe(max);
      const refused = await deposit(player.user, bank.bankId, 1, 100, undefined, open);
      expect([codeOf(refused), refused.status]).toEqual(['DEPOSIT_LIMIT', 409]);
      expect([await balanceOf(player.houseId), await vaultOf(bank.bankId)]).toEqual([1, max]);
      expect(await heldBy(player.houseId, bank.bankId)).toBe(max);
    } finally {
      // Le monde rendu à des soldes ordinaires : le tableau de bord d'Olympe, qui lit tous les mondes, rend leur masse
      // monétaire en entiers sûrs. Le dépôt revient à la trésorerie, puis l'excédent de la dotation au robinet.
      const held = await heldBy(player.houseId, bank.bankId);
      if (held) await withdraw(player.user, bank.bankId, held, open);
      const { rows } = await sql<{ excess: string }>`select (balance - ${GRANT})::text as excess
        from game.accounts where house_id = ${player.houseId} and kind = 'house'`.execute(owner);
      const excess = rows[0]?.excess ?? '0';
      if (BigInt(excess) > 0n)
        await sql`with entry as (insert into game.ledger_entries (world_id, kind)
            values (${world}, 'test.fund') returning id)
          insert into game.ledger_lines (entry_id, account_id, amount)
          select entry.id, a.id, case when a.kind = 'house' then -${excess}::bigint else ${excess}::bigint end
          from entry join game.accounts a on a.world_id = ${world}
          where (a.kind = 'house' and a.house_id = ${player.houseId})
             or a.system_key = 'faucet_starting_grant'`.execute(owner);
    }
  });

  it('refus sans effet : banques fermées, banque inconnue ou la sienne, taux changé, trésorerie, solde, pas de dépôt', async () => {
    const bank = await newBank();
    const player = await newPlayer(KALLISTE);
    const before = [await balanceOf(player.houseId), await vaultOf(bank.bankId)];
    const refusals = [
      [
        await deposit(player.user, bank.bankId, 10, 100, undefined, withRules(null)),
        'BANKS_CLOSED',
      ],
      [await deposit(player.user, randomUUID(), 10), 'BANK_NOT_FOUND'],
      [await deposit(bank.user, bank.bankId, 10), 'OWN_BANK'],
      [await deposit(player.user, bank.bankId, 10, 200), 'RATE_CHANGED'],
      [await deposit(player.user, bank.bankId, GRANT + 1), 'INSUFFICIENT_FUNDS'],
      [await withdraw(player.user, bank.bankId, 1), 'DEPOSIT_NOT_FOUND'],
      [await withdraw(player.user, randomUUID(), 1), 'BANK_NOT_FOUND'],
      [await withdraw(bank.user, bank.bankId, 1), 'DEPOSIT_NOT_FOUND'],
    ] as const;
    for (const [reply, code] of refusals)
      expect([codeOf(reply), reply.status]).toEqual([code, code.endsWith('NOT_FOUND') ? 404 : 409]);
    expect((await deposit(player.user, bank.bankId, 10, 200)).body.error?.message).toContain('100');
    expect([await balanceOf(player.houseId), await vaultOf(bank.bankId)]).toEqual(before);
    expect(await heldBy(player.houseId, bank.bankId)).toBeNull();
    // Toute la trésorerie : le solde nul est admis ; le retrait reste ouvert sans section `banks`.
    expect((await deposit(player.user, bank.bankId, GRANT)).body.data.balance).toBe(GRANT);
    expect(await balanceOf(player.houseId)).toBe(0);
    expect(codeOf(await withdraw(player.user, bank.bankId, GRANT + 1))).toBe('ABOVE_BALANCE');
    expect((await withdraw(player.user, bank.bankId, GRANT + 1)).body.error?.message).toContain(
      String(GRANT),
    );
    expect((await withdraw(player.user, bank.bankId, GRANT, withRules(null))).status).toBe(200);
    expect([await balanceOf(player.houseId), await vaultOf(bank.bankId)]).toEqual(before);
  });

  it('la réserve exigée borne le retrait de capital du banquier, jamais celui des déposants : ruée jusqu’au coffre vide', async () => {
    const bank = await newBank(3_000);
    const [a, b] = [await newPlayer(KALLISTE), await newPlayer(ELAIA)];
    await fund(a.houseId, 4_000);
    await fund(b.houseId, 1_000);
    await deposit(a.user, bank.bankId, 6_001);
    await deposit(b.user, bank.bankId, 4_000);
    // 20 % de 10 001 oboles : 2 000,2, arrondis à 2 001, au-dessus du capital minimal.
    const [reserve, vault] = [Number(bankRequiredReserve(10_001n, RULES)), 3_000 + 10_001];
    expect(reserve).toBe(2_001);
    expect(codeOf(await moveCapital(bank.user, 'out', vault - reserve + 1))).toBe('RESERVE_SHORT');
    const out = await moveCapital(bank.user, 'out', vault - reserve);
    expect(out.body.data).toMatchObject({ vault: reserve, requiredReserve: reserve });
    // Le coffre est à la réserve, sous les dépôts : la ruée commence. Chaque déposant reprend ce que le coffre couvre.
    expect((await withdraw(b.user, bank.bankId, 2_000)).status).toBe(200);
    expect(await vaultOf(bank.bankId)).toBe(1);
    expect(codeOf(await withdraw(a.user, bank.bankId, 2))).toBe('VAULT_SHORT');
    expect((await withdraw(a.user, bank.bankId, 1)).status).toBe(200);
    expect(await vaultOf(bank.bankId)).toBe(0);
    for (const player of [a, b])
      expect(codeOf(await withdraw(player.user, bank.bankId, 1))).toBe('VAULT_SHORT');
    // Les créances restent dues ; le coffre vide, les trésoreries tiennent toute la monnaie versée (dotations, 8 000).
    expect([await heldBy(a.houseId, bank.bankId), await heldBy(b.houseId, bank.bankId)]).toEqual([
      6_000, 2_000,
    ]);
    const cash = [bank, a, b].map((house) => balanceOf(house.houseId));
    expect((await Promise.all(cash)).reduce((sum, n) => sum + n, 0)).toBe(
      3 * GRANT + 3_000 + 5_000,
    );
    // Le banquier ne retire plus rien : la réserve exigée vaut toujours sur les dépôts dus.
    expect(codeOf(await moveCapital(bank.user, 'out', 1))).toBe('RESERVE_SHORT');
  });

  it('ruée concurrente jusqu’au coffre vide : chaque obole sort une fois, aucun retrait de trop', async () => {
    const bank = await newBank();
    const players = await Promise.all([1, 2, 3, 4].map(() => newPlayer(KALLISTE)));
    for (const player of players) await deposit(player.user, bank.bankId, 2_000);
    const vault = await vaultOf(bank.bankId);
    expect(vault).toBe(1_500 + 8_000);
    // La réserve exigée (20 % de 8 000 : 1 600) laisse 7 900 au banquier, qui les prend.
    await moveCapital(bank.user, 'out', vault - Number(bankRequiredReserve(8_000n, RULES)));
    expect(await vaultOf(bank.bankId)).toBe(1_600);
    const race = await Promise.all(players.map((p) => withdraw(p.user, bank.bankId, 800)));
    // 1 600 au coffre, quatre retraits de 800 : deux passent, deux trouvent le coffre vide.
    expect(race.map((reply) => codeOf(reply) ?? 'ok').sort()).toEqual([
      'VAULT_SHORT',
      'VAULT_SHORT',
      'ok',
      'ok',
    ]);
    expect(await vaultOf(bank.bankId)).toBe(0);
    const held = await Promise.all(players.map((p) => heldBy(p.houseId, bank.bankId)));
    expect(held.reduce<number>((sum, n) => sum + (n ?? 0), 0)).toBe(8_000 - 1_600);
    // Deux retraits concurrents du même solde : un seul passe.
    const other = await newBank();
    const saver = await newPlayer(ELAIA);
    await deposit(saver.user, other.bankId, 500);
    const twice = await Promise.all([
      withdraw(saver.user, other.bankId, 500),
      withdraw(saver.user, other.bankId, 500),
    ]);
    expect(twice.map((reply) => codeOf(reply) ?? 'ok').sort()).toEqual(['ABOVE_BALANCE', 'ok']);
    expect([await balanceOf(saver.houseId), await heldBy(saver.houseId, other.bankId)]).toEqual([
      GRANT,
      0,
    ]);
    // Dépôts concurrents d'une même maison : chacun passe, rien ne se perd.
    await Promise.all([10, 20, 30].map((n) => deposit(saver.user, other.bankId, n)));
    expect(await heldBy(saver.houseId, other.bankId)).toBe(60);
    expect(await vaultOf(other.bankId)).toBe(1_500 + 60);
  });
});

describe('bank.setRates', () => {
  const rates = (
    user: string,
    depositRateBps: number,
    loanRateBps: number,
    key?: string,
    via = app,
  ) => send(user, 'bank.setRates', { depositRateBps, loanRateBps }, key, via);
  const ratesOf = async (bankId: string) =>
    (
      await sql<{ rates: string }>`select deposit_rate_bps || ':' || loan_rate_bps as rates
        from game.banks where id = ${bankId}`.execute(owner)
    ).rows[0]?.rates;

  it('les taux affichés changent dans les bornes du monde ; un dépôt au taux vu ancien est refusé', async () => {
    const bank = await newBank();
    const player = await newPlayer(ELAIA);
    const key = randomUUID();
    const done = await rates(bank.user, 1_000, 5_000, key);
    expect(done.body.data).toEqual({
      bankId: bank.bankId,
      depositRateBps: 1_000,
      loanRateBps: 5_000,
    });
    expect(await rates(bank.user, 1_000, 5_000, key)).toEqual(done);
    expect(await ratesOf(bank.bankId)).toBe('1000:5000');
    const refusals = [
      [await rates(bank.user, 1_001, 300), 'RATE_OUT_OF_BOUNDS'],
      [await rates(bank.user, 99, 300), 'RATE_OUT_OF_BOUNDS'],
      [await rates(bank.user, 100, 299), 'RATE_OUT_OF_BOUNDS'],
      [await rates(bank.user, 100, 5_001), 'RATE_OUT_OF_BOUNDS'],
      [await rates(bank.user, 100, 300, undefined, withRules(null)), 'BANKS_CLOSED'],
      [await rates(player.user, 100, 300), 'BANK_NOT_FOUND'],
    ] as const;
    for (const [reply, code] of refusals) expect(codeOf(reply)).toBe(code);
    expect((await rates(bank.user, 1_001, 300)).body.error?.message).toContain('100 to 1000');
    expect(await ratesOf(bank.bankId)).toBe('1000:5000');
    expect(await eventsOf(bank.houseId, 'BankRatesSet')).toEqual([
      { ...done.body.data, houseId: bank.houseId },
    ]);
    // Le déposant a vu l'ancien taux : refusé, le message donne le nouveau ; au nouveau, il passe.
    expect(codeOf(await deposit(player.user, bank.bankId, 10, 100))).toBe('RATE_CHANGED');
    expect((await deposit(player.user, bank.bankId, 10, 100)).body.error?.message).toContain(
      '1000',
    );
    expect((await deposit(player.user, bank.bankId, 10, 1_000)).body.data.rateBps).toBe(1_000);
    // Des bornes resserrées refusent un changement, pas le taux déjà affiché, que les dépôts gardent.
    const narrow = withRules({ ...RULES, depositRateBps: { min: 100, max: 500 } });
    expect(codeOf(await rates(bank.user, 1_000, 5_000, undefined, narrow))).toBe(
      'RATE_OUT_OF_BOUNDS',
    );
    expect((await deposit(player.user, bank.bankId, 10, 1_000, undefined, narrow)).status).toBe(
      200,
    );
    expect((await rates(bank.user, 500, 300, undefined, narrow)).status).toBe(200);
  });

  it('un changement de taux et un dépôt concurrents : le dépôt passe au taux vu, ou il est refusé', async () => {
    for (let run = 0; run < 3; run += 1) {
      const bank = await newBank();
      const player = await newPlayer(KALLISTE);
      const [set, put] = await Promise.all([
        rates(bank.user, 500, 300),
        deposit(player.user, bank.bankId, 100, 100),
      ]);
      expect(set.status).toBe(200);
      const { rows } = await sql<{
        rate: number;
      }>`select rate_bps as rate from game.bank_deposit_movements
        where bank_id = ${bank.bankId}`.execute(owner);
      if (put.status === 200) expect(rows).toEqual([{ rate: 100 }]);
      else expect([codeOf(put), rows]).toEqual(['RATE_CHANGED', []]);
    }
  });
});

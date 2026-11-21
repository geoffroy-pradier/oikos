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

// Trésor du temple (#724), contre Supabase local : taux de 10 %, 1 000 oboles dès une Timè nulle, 5 000 dès 50.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
type Rules = NonNullable<GameConfig['templeTreasury']>;
const RULES: Rules = {
  policyRateBps: 1_000,
  termDays: [7, 365],
  principalCaps: [
    { minHonor: 0, maxPrincipal: 1_000 },
    { minHonor: 50, maxPrincipal: 5_000 },
  ],
};
const withRules = (rules: Rules | null): App =>
  appWithConfig((config) => {
    const next: GameConfig = { ...config };
    if (rules) next.templeTreasury = rules;
    else delete next.templeTreasury;
    return next;
  });
const app = withRules(RULES);
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;
const borrow = (user: string, principal: number, termDays = 365, rate = 1_000, via = app) =>
  send(
    user,
    'loan.borrowFromTemple',
    { principal, termDays, expectedRateBps: rate },
    undefined,
    via,
  );
const repay = (user: string, loanId: string, amount: number, key?: string) =>
  send(user, 'loan.repay', { loanId, amount }, key, app);
/** Timè posée par le propriétaire, gardes levées : le journal n'admet que ses motifs. */
async function setHonor(houseId: string, honor: number) {
  await owner.transaction().execute(async (trx) => {
    await sql`set local session_replication_role = replica`.execute(trx);
    await sql`insert into game.honor (house_id, world_id, honor)
      select id, world_id, ${honor} from game.houses where id = ${houseId}
      on conflict (house_id) do update set honor = excluded.honor`.execute(trx);
  });
}
/** Modifie un prêt gardes levées (`set` : une affectation SQL écrite par le test). */
async function force(loanId: string, set: string) {
  await owner.transaction().execute(async (trx) => {
    await sql`set local session_replication_role = replica`.execute(trx);
    await sql`update game.loans set ${sql.raw(set)} where id = ${loanId}`.execute(trx);
  });
}
/** État, principal, intérêts, remboursés et reste dû du prêt. */
const stateOf = async (loanId: string) =>
  (
    await sql<{ s: string }>`select concat_ws(':', status, principal, interest, principal_repaid,
      interest_repaid, outstanding) as s from game.loans where id = ${loanId}`.execute(db)
  ).rows[0]?.s;
/** Lignes des écritures du prêt, décaissement puis remboursements : nature, compte et montant. */
const linesOf = async (loanId: string) =>
  (
    await sql<{
      line: string;
    }>`select e.kind || ':' || coalesce(a.system_key, a.kind) || ':' || l.amount as line
      from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
      join game.accounts a on a.id = l.account_id
      where e.id = (select disbursement_entry_id from game.loans where id = ${loanId})
         or e.id in (select ledger_entry_id from game.loan_repayments where loan_id = ${loanId})
      order by e.kind, l.amount`.execute(db)
  ).rows.map((row) => row.line);
const SYSTEM = ['faucet_temple_loans', 'sink_temple_interest'] as const;
const systemBalances = async () => Promise.all(SYSTEM.map((key) => balanceOf(key)));

describe('loan.borrowFromTemple', () => {
  it('le robinet crée le principal en une écriture, intérêt simple arrondi à l’obole supérieure ; rejouable', async () => {
    const player = await newPlayer(KALLISTE);
    const [faucet] = await systemBalances();
    const key = randomUUID();
    // 1 000 oboles à 10 % pour 7 jours : 1,917… arrondi à 2.
    const input = { principal: 1_000, termDays: 7, expectedRateBps: 1_000 };
    const done = await send(player.user, 'loan.borrowFromTemple', input, key, app);
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({
      principal: 1_000,
      rateBps: 1_000,
      termDays: 7,
      interest: 2,
      outstanding: 1_002,
    });
    const loanId = done.body.data.loanId as string;
    expect(await stateOf(loanId)).toBe('active:1000:2:0:0:1002');
    expect(await linesOf(loanId)).toEqual([
      'loan.temple_disburse:faucet_temple_loans:-1000',
      'loan.temple_disburse:house:1000',
    ]);
    expect([await balanceOf(player.houseId), await balanceOf(SYSTEM[0])]).toEqual([
      GRANT + 1_000,
      (faucet ?? 0) - 1_000,
    ]);
    const { houseId } = player;
    expect(await eventsOf(houseId, 'LoanDisbursed')).toEqual([
      { ...done.body.data, houseId, lender: 'temple' },
    ]);
    // L'échéance est la clôture 7 jours de jeu après l'emprunt.
    const { rows } = await sql<{
      days: number;
      at: Date;
    }>`select due_day - borrowed_day as days, due_at as at
      from game.loans where id = ${loanId}`.execute(db);
    expect(rows[0]?.days).toBe(7);
    expect(rows[0]?.at.toISOString()).toBe(done.body.data.dueAt);
    // Même clé : même réponse, rien de plus créé ; autre clé : un prêt est déjà en cours.
    expect(await send(player.user, 'loan.borrowFromTemple', input, key, app)).toEqual(done);
    expect(codeOf(await borrow(player.user, 10, 7))).toBe('LOAN_OUTSTANDING');
    expect(await balanceOf(player.houseId)).toBe(GRANT + 1_000);
  });

  it('refus sans rien créer : temple fermé, taux changé, durée, plafond du palier de Timè', async () => {
    const player = await newPlayer(KALLISTE);
    const before = await systemBalances();
    const refusals = [
      [await borrow(player.user, 100, 7, 1_000, withRules(null)), 'TEMPLE_CLOSED'],
      [await borrow(player.user, 100, 7, 999), 'RATE_CHANGED'],
      [await borrow(player.user, 100, 8), 'TERM_NOT_OFFERED'],
      [await borrow(player.user, 1_001, 7), 'ABOVE_CAP'],
      // Configuration initiale : plafonds nuls, le temple ne prête rien.
      [await borrow(player.user, 1, 7, 1_000, appWithConfig()), 'ABOVE_CAP'],
    ] as const;
    for (const [reply, code] of refusals) expect(codeOf(reply)).toBe(code);
    expect(refusals[1][0].body.error?.message).toContain('1000');
    // Sous le premier palier, rien ; au palier de 50, 5 000 tout juste.
    await setHonor(player.houseId, -1);
    expect(codeOf(await borrow(player.user, 1, 7))).toBe('ABOVE_CAP');
    await setHonor(player.houseId, 50);
    expect(codeOf(await borrow(player.user, 5_001, 7))).toBe('ABOVE_CAP');
    expect(await balanceOf(player.houseId)).toBe(GRANT);
    expect(await systemBalances()).toEqual(before);
    expect(await eventsOf(player.houseId, 'LoanDisbursed')).toEqual([]);
    expect((await borrow(player.user, 5_000, 7)).body.data).toMatchObject({ interest: 10 });
  });

  it('deux emprunts concurrents, sous deux clés : un seul prêt', async () => {
    const player = await newPlayer(KALLISTE);
    const replies = await Promise.all([borrow(player.user, 600, 7), borrow(player.user, 400, 365)]);
    expect(replies.filter((reply) => reply.status === 200)).toHaveLength(1);
    expect(replies.map(codeOf).filter(Boolean)).toEqual(['LOAN_OUTSTANDING']);
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from game.loans
      where borrower_house_id = ${player.houseId}`.execute(db);
    expect(rows[0]?.n).toBe(1);
    const principal = replies.find((reply) => reply.status === 200)?.body.data.principal as number;
    expect(await balanceOf(player.houseId)).toBe(GRANT + principal);
  });

  it('un prêt de banque ne compte pas pour le prêt unique, mais en défaut il déshonore ; un prêt en défaut se rembourse', async () => {
    const player = await newPlayer(KALLISTE);
    const first = (await borrow(player.user, 500, 7)).body.data.loanId as string;
    // Prêteur et état posés gardes levées : aucune banque ne prête encore (#728), aucun prêt n'est en défaut (#725).
    await force(first, `lender = 'bank'`);
    const temple = await borrow(player.user, 300, 7);
    expect(temple.status).toBe(200);
    await force(first, `status = 'defaulted'`);
    expect(codeOf(await borrow(player.user, 100, 7))).toBe('DISHONORED');
    // `loan.repay` ne rembourse encore que le temple : un prêt de banque lui est inconnu.
    expect(codeOf(await repay(player.user, first, 1))).toBe('LOAN_NOT_FOUND');
    // Le prêt du temple remboursé, le prêt de banque en défaut déshonore encore.
    expect((await repay(player.user, temple.body.data.loanId, 301)).body.data).toMatchObject({
      status: 'repaid',
    });
    expect(codeOf(await borrow(player.user, 100, 7))).toBe('DISHONORED');
    await force(first, `lender = 'temple'`);
    expect((await repay(player.user, first, 501)).body.data).toMatchObject({
      outstanding: 0,
      status: 'repaid',
    });
  });
});

describe('loan.repay', () => {
  it('intérêts d’abord, au puits ; le principal recrédite le robinet ; remboursé, le prêt libère la maison', async () => {
    const player = await newPlayer(KALLISTE);
    // 1 000 oboles pour un an : 100 d'intérêts.
    const loanId = (await borrow(player.user, 1_000)).body.data.loanId as string;
    const [faucet, sink] = await systemBalances();
    const key = randomUUID();
    const first = await repay(player.user, loanId, 60, key);
    expect(first.body.data).toEqual({
      loanId,
      interest: 60,
      principal: 0,
      outstanding: 1_040,
      status: 'active',
    });
    expect(await repay(player.user, loanId, 60, key)).toEqual(first);
    const second = await repay(player.user, loanId, 540);
    expect(second.body.data).toMatchObject({ interest: 40, principal: 500, outstanding: 500 });
    expect(codeOf(await repay(player.user, loanId, 501))).toBe('ABOVE_OUTSTANDING');
    const last = await repay(player.user, loanId, 500);
    expect(last.body.data).toMatchObject({
      interest: 0,
      principal: 500,
      outstanding: 0,
      status: 'repaid',
    });
    expect(await stateOf(loanId)).toBe('repaid:1000:100:1000:100:0');
    expect(await linesOf(loanId)).toEqual([
      'loan.repay:house:-540',
      'loan.repay:house:-500',
      'loan.repay:house:-60',
      'loan.repay:sink_temple_interest:40',
      'loan.repay:sink_temple_interest:60',
      'loan.repay:faucet_temple_loans:500',
      'loan.repay:faucet_temple_loans:500',
      'loan.temple_disburse:faucet_temple_loans:-1000',
      'loan.temple_disburse:house:1000',
    ]);
    // Conservation : la maison a payé les intérêts, que le puits a détruits ; le robinet a repris le principal.
    expect(await balanceOf(player.houseId)).toBe(GRANT - 100);
    expect(await systemBalances()).toEqual([(faucet ?? 0) + 1_000, (sink ?? 0) + 100]);
    const { houseId } = player;
    expect((await eventsOf(houseId, 'LoanRepaid')).map((event) => event['outstanding'])).toEqual([
      1_040, 500, 0,
    ]);
    expect(codeOf(await repay(player.user, loanId, 1))).toBe('LOAN_REPAID');
    expect((await borrow(player.user, 10, 7)).status).toBe(200);
  });

  it('refus sans rien payer : prêt d’une autre maison ou inconnu, trésorerie insuffisante', async () => {
    const [player, other] = [await newPlayer(KALLISTE), await newPlayer(KALLISTE)];
    // 1 000 oboles pour un an : reste dû 1 100. Le propriétaire en détruit tout sauf 50 oboles de la trésorerie.
    const loanId = (await borrow(player.user, 1_000)).body.data.loanId as string;
    expect(codeOf(await repay(other.user, loanId, 10))).toBe('LOAN_NOT_FOUND');
    expect(codeOf(await repay(player.user, randomUUID(), 10))).toBe('LOAN_NOT_FOUND');
    const spend = GRANT + 1_000 - 50;
    await owner.transaction().execute(async (trx) => {
      const { rows } = await sql<{ id: string }>`insert into game.ledger_entries (world_id, kind)
        select world_id, 'test.spend' from game.houses where id = ${player.houseId} returning id`.execute(
        trx,
      );
      await sql`insert into game.ledger_lines (entry_id, account_id, amount)
        select ${rows[0]?.id}, id, case when kind = 'house' then ${-spend}::bigint else ${spend}::bigint end from game.accounts
        where house_id = ${player.houseId} and kind = 'house'
           or (world_id = (select world_id from game.houses where id = ${player.houseId})
               and system_key = 'sink_upkeep')`.execute(trx);
    });
    expect(codeOf(await repay(player.user, loanId, 51))).toBe('INSUFFICIENT_FUNDS');
    expect(await stateOf(loanId)).toBe('active:1000:100:0:0:1100');
    // Solde nul : toute la trésorerie, en intérêts.
    expect((await repay(player.user, loanId, 50)).body.data).toMatchObject({
      interest: 50,
      outstanding: 1_050,
    });
    expect(await balanceOf(player.houseId)).toBe(0);
    expect(await eventsOf(other.houseId, 'LoanRepaid')).toEqual([]);
  });

  it('deux remboursements concurrents qui dépassent ensemble le reste dû : l’un passe, jamais de reste dû négatif', async () => {
    const player = await newPlayer(KALLISTE);
    const loanId = (await borrow(player.user, 1_000, 7)).body.data.loanId as string;
    const replies = await Promise.all([
      repay(player.user, loanId, 700),
      repay(player.user, loanId, 700),
    ]);
    expect(replies.filter((reply) => reply.status === 200)).toHaveLength(1);
    expect(replies.map(codeOf).filter(Boolean)).toEqual(['ABOVE_OUTSTANDING']);
    expect(await stateOf(loanId)).toBe('active:1000:2:698:2:302');
    // Deux remboursements qui tiennent ensemble : tous deux passent, les intérêts une seule fois.
    const fresh = await newPlayer(KALLISTE);
    const second = (await borrow(fresh.user, 1_000, 7)).body.data.loanId as string;
    const both = await Promise.all([
      repay(fresh.user, second, 1),
      repay(fresh.user, second, 1_001),
    ]);
    expect(both.map((reply) => reply.status)).toEqual([200, 200]);
    expect(await stateOf(second)).toBe('repaid:1000:2:1000:2:0');
  });
});

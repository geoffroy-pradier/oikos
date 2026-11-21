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
/** Timè posée par le propriétaire, gardes levées : le journal n'admet que ses motifs. */
async function setHonor(houseId: string, honor: number) {
  await owner.transaction().execute(async (trx) => {
    await sql`set local session_replication_role = replica`.execute(trx);
    await sql`insert into game.honor (house_id, world_id, honor)
      select id, world_id, ${honor} from game.houses where id = ${houseId}
      on conflict (house_id) do update set honor = excluded.honor`.execute(trx);
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
});

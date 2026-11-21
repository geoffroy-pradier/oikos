import { randomUUID } from 'node:crypto';
import type { GameConfig } from '@oikos/config';
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

// Banques de joueurs (#726), contre Supabase local : droit de 500 oboles, capital minimal de 1 500.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
type Rules = NonNullable<GameConfig['banks']>;
const RULES: Rules = {
  charterFeeOboles: 500,
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
/** Un nom libre : les bancs et les autres tests partagent le monde du jeu d'essai. */
const freshName = () => `Trapeza ${[...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('')}`;
const found = (user: string, capital: number, name = freshName(), fee = 500, via = app) =>
  send(user, 'bank.found', { name, capital, expectedCharterFee: fee }, undefined, via);
/** Banques de la maison et leur coffre, lus par le propriétaire : le service ne voit pas les coffres. */
const bankOf = async (houseId: string) => {
  const { rows } = await sql<{ n: string; vault: string | null }>`select count(*) as n,
      sum(a.balance)::text as vault from game.banks b join game.accounts a on a.bank_id = b.id
    where b.house_id = ${houseId}`.execute(owner);
  return { banks: Number(rows[0]?.n), vault: Number(rows[0]?.vault ?? 0) };
};
const vaultOf = async (houseId: string) => (await bankOf(houseId)).vault;
const banksOf = async (houseId: string) => (await bankOf(houseId)).banks;
/** Écritures de la banque : nature, compte (clé système, `house` ou `vault`) et montant. */
const linesOf = async (bankId: string) =>
  (
    await sql<{ line: string }>`select e.kind || ':' || coalesce(a.system_key,
        case when a.bank_id is not null then 'vault' else a.kind end) || ':' || l.amount as line
      from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
      join game.accounts a on a.id = l.account_id
      where e.meta ->> 'bankId' = ${bankId} order by e.created_at, e.id, l.amount`.execute(owner)
  ).rows.map((row) => row.line);

describe('bank.found', () => {
  it('le droit est détruit, le capital passe au coffre, en une transaction ; rejouable', async () => {
    const player = await newPlayer(KALLISTE);
    await fund(player.houseId, 2_000);
    const sink = await balanceOf('sink_bank_charter');
    const key = randomUUID();
    const input = { name: freshName(), capital: 1_500, expectedCharterFee: 500 };
    const done = await send(player.user, 'bank.found', input, key, app);
    expect(done.status).toBe(200);
    const bankId = done.body.data.bankId as string;
    expect(done.body.data).toEqual({
      bankId,
      cityId: KALLISTE,
      name: input.name,
      charterFee: 500,
      capital: 1_500,
      depositRateBps: 100,
      loanRateBps: 300,
    });
    expect(await linesOf(bankId)).toEqual([
      'bank.charter:house:-500',
      'bank.charter:sink_bank_charter:500',
      'bank.capital_in:house:-1500',
      'bank.capital_in:vault:1500',
    ]);
    expect([await balanceOf(player.houseId), await vaultOf(player.houseId)]).toEqual([
      GRANT + 2_000 - 2_000,
      1_500,
    ]);
    expect(await balanceOf('sink_bank_charter')).toBe(sink + 500);
    expect(await eventsOf(player.houseId, 'BankFounded')).toEqual([
      { ...done.body.data, houseId: player.houseId },
    ]);
    // Même clé : même réponse, rien de plus ; autre clé : la maison a déjà sa banque.
    expect(await send(player.user, 'bank.found', input, key, app)).toEqual(done);
    expect(codeOf(await found(player.user, 1_500))).toBe('BANK_EXISTS');
    expect(await banksOf(player.houseId)).toBe(1);
    expect(await balanceOf(player.houseId)).toBe(GRANT);
  });

  it('refus sans rien créer : banques fermées, droit changé, capital trop bas, trésorerie, nom pris', async () => {
    const [player, rival] = [await newPlayer(KALLISTE), await newPlayer(ELAIA)];
    const taken = freshName();
    expect((await found(rival.user, 1_500, taken)).status).toBe(200);
    const sink = await balanceOf('sink_bank_charter');
    const refusals = [
      // Configuration initiale : pas de section `banks`.
      [await found(player.user, 1_500, freshName(), 500, withRules(null)), 'BANKS_CLOSED'],
      [await found(player.user, 1_500, freshName(), 499), 'FEE_CHANGED'],
      [await found(player.user, 1_499), 'CAPITAL_TOO_LOW'],
      // Droit et capital passent ensemble la trésorerie d’une obole : tout ou rien, le droit n’est pas payé seul.
      [await found(player.user, GRANT - 499), 'INSUFFICIENT_FUNDS'],
      [await found(player.user, 1_500, taken.toUpperCase()), 'NAME_TAKEN'],
    ] as const;
    for (const [reply, code] of refusals)
      expect([codeOf(reply), reply.status]).toEqual([code, 409]);
    expect(await banksOf(player.houseId)).toBe(0);
    expect([await balanceOf(player.houseId), await balanceOf('sink_bank_charter')]).toEqual([
      GRANT,
      sink,
    ]);
    // Un capital juste suffisant, toute la trésorerie : le solde nul est admis.
    expect((await found(player.user, GRANT - 500)).status).toBe(200);
    expect([await balanceOf(player.houseId), await vaultOf(player.houseId)]).toEqual([
      0,
      GRANT - 500,
    ]);
  });

  it('sans droit ni capital minimal : ni écriture, un coffre vide', async () => {
    const free = withRules({ ...RULES, charterFeeOboles: 0, minCapitalOboles: 0 });
    const player = await newPlayer(KALLISTE);
    const done = await found(player.user, 0, freshName(), 0, free);
    expect(done.status).toBe(200);
    expect(await linesOf(done.body.data.bankId as string)).toEqual([]);
    expect([await balanceOf(player.houseId), await vaultOf(player.houseId)]).toEqual([GRANT, 0]);
  });

  it('deux fondations concurrentes d’une maison : une seule banque', async () => {
    const player = await newPlayer(KALLISTE);
    await fund(player.houseId, 10_000);
    const twice = await Promise.all([found(player.user, 1_500), found(player.user, 1_500)]);
    expect(twice.map((reply) => reply.status ?? 0).sort()).toEqual([200, 409]);
    expect(twice.map(codeOf).filter(Boolean)).toEqual(['BANK_EXISTS']);
    expect(await banksOf(player.houseId)).toBe(1);
    expect(await balanceOf(player.houseId)).toBe(GRANT + 10_000 - 2_000);
  });
});

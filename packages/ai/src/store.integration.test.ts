import { DEFAULT_AI } from '@oikos/config/schema';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGateway, dbCallStore, fakeProvider, type AiSettings } from './index';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
afterAll(() => db.destroy());

const store = dbCallStore(db);
/**
 * Un mois tiré au hasard dans le passé lointain : le journal est en ajout seul et partagé entre les
 * exécutions, donc chaque test part de la dépense déjà enregistrée ce mois-là et ne compte que ses écarts.
 */
const year = 1900 + Math.floor(Math.random() * 100);
const month = Math.floor(Math.random() * 12);
const inMonth = (day: number, hour = 12) => new Date(Date.UTC(year, month, day, hour));

const call = (at: Date, costMicroEuros: number) => ({
  usage: 'chronicle' as const,
  model: 'small',
  inputTokens: 10,
  outputTokens: 5,
  costMicroEuros,
  outcome: 'ok' as const,
  durationMs: 3,
  at,
});

describe('journal des appels en base (telemetry.ai_calls)', () => {
  it('la dépense du mois somme les coûts de l’usage dans le mois civil UTC, et eux seuls', async () => {
    const first = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const last = new Date(Date.UTC(year, month + 1, 1) - 1);
    const before = await store.spentThisMonth('chronicle', inMonth(15));
    const nextBefore = await store.spentThisMonth(
      'chronicle',
      new Date(Date.UTC(year, month + 1, 1)),
    );
    const oracleBefore = await store.spentThisMonth('oracle', inMonth(15));

    await store.record(call(first, 100));
    await store.record(call(last, 20));
    await store.record(call(new Date(Date.UTC(year, month + 1, 1)), 3)); // le mois suivant
    await store.record({ ...call(inMonth(10), 7), usage: 'oracle' });

    expect((await store.spentThisMonth('chronicle', inMonth(15))) - before).toBe(120);
    expect(
      (await store.spentThisMonth('chronicle', new Date(Date.UTC(year, month + 1, 20)))) -
        nextBefore,
    ).toBe(3);
    expect((await store.spentThisMonth('oracle', inMonth(2))) - oracleBefore).toBe(7);
  });

  it('la passerelle coupe l’usage quand le journal en base atteint le plafond', async () => {
    const at = inMonth(20);
    const spent = await store.spentThisMonth('steward', at);
    // Plafond = ce mois-ci déjà dépensé + 1 000 µ€ : un budget par « joueur » égal au plafond, une part entière.
    const settings: AiSettings = {
      ...DEFAULT_AI,
      budgetMicroEurosPerActivePlayerMonth: spent + 1_000,
      expectedActivePlayers: 1,
      usages: {
        ...DEFAULT_AI.usages,
        steward: {
          enabled: true,
          model: 'small',
          timeoutMs: 1_000,
          maxOutputTokens: 100,
          capShareBps: 10_000,
          inputMicroEurosPerThousandTokens: 600,
          outputMicroEurosPerThousandTokens: 0,
        },
      },
    };
    const provider = fakeProvider([{ text: '{"ok":true}', inputTokens: 1_000, outputTokens: 0 }]);
    const run = createGateway({ provider, store, settings: () => settings, now: () => at });
    const ask = () =>
      run({
        usage: 'steward',
        instructions: 'x',
        data: null,
        schema: z.strictObject({ ok: z.boolean() }),
        fallback: { ok: false },
      });

    // Appels de 600 µ€ : le premier passe (0 dépensé), le second aussi (600 < 1 000), le troisième est coupé (1 200).
    expect((await ask()).outcome).toBe('ok');
    expect((await ask()).outcome).toBe('ok');
    expect((await ask()).outcome).toBe('capped');
    expect(provider.requests).toHaveLength(2);

    const { rows } = await sql<{ outcome: string; cost: string }>`
      select outcome, cost_micro_euros as cost from telemetry.ai_calls
      where usage = 'steward' and called_at = ${at} order by created_at desc limit 3`.execute(db);
    expect(rows.map((row) => [row.outcome, Number(row.cost)])).toEqual([
      ['capped', 0],
      ['ok', 600],
      ['ok', 600],
    ]);
  });
});

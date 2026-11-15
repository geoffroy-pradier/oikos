import { DEFAULT_AI } from '@oikos/config/schema';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createGateway,
  estimateCostMicroEuros,
  fakeProvider,
  memoryStore,
  type AiSettings,
  type FakeReply,
} from './index';

const oracleSchema = z.strictObject({ text: z.string().min(1).max(280) });
const FALLBACK = { text: 'La Pythie se tait.' };
const reply = (value: unknown, inputTokens = 1000, outputTokens = 200) => ({
  text: JSON.stringify(value),
  inputTokens,
  outputTokens,
});

/** Oracle ouvert : 0,08 € × 100 joueurs = 8 €, dont un quart (2 €) pour l'oracle. */
function settings(patch: Partial<AiSettings['usages']['oracle']> = {}): AiSettings {
  return {
    ...DEFAULT_AI,
    budgetMicroEurosPerActivePlayerMonth: 80_000,
    expectedActivePlayers: 100,
    usages: {
      ...DEFAULT_AI.usages,
      oracle: {
        enabled: true,
        model: 'small',
        timeoutMs: 1_000,
        maxOutputTokens: 300,
        capShareBps: 2_500,
        inputMicroEurosPerThousandTokens: 150,
        outputMicroEurosPerThousandTokens: 600,
        ...patch,
      },
    },
  };
}

function setup(replies: FakeReply[], current = settings(), at = new Date('2026-12-15T10:00:00Z')) {
  const provider = fakeProvider(replies);
  const store = memoryStore();
  const run = createGateway({ provider, store, settings: () => current, now: () => at });
  const ask = (data: unknown = { event: 'storm' }) =>
    run({
      usage: 'oracle',
      instructions: 'Rédige un oracle.',
      data,
      schema: oracleSchema,
      fallback: FALLBACK,
    });
  return { provider, store, ask };
}

describe('passerelle IA', () => {
  it('une sortie conforme passe ; l’appel est journalisé avec ses jetons et son coût, sans texte', async () => {
    const { store, ask } = setup([reply({ text: 'Quand la mer gronde…' }, 1000, 200)]);
    expect(await ask()).toEqual({
      value: { text: 'Quand la mer gronde…' },
      source: 'ai',
      outcome: 'ok',
    });
    // 1 000 × 150 / 1 000 + 200 × 600 / 1 000 = 150 + 120 µ€.
    expect(store.calls).toEqual([
      {
        usage: 'oracle',
        model: 'small',
        inputTokens: 1000,
        outputTokens: 200,
        costMicroEuros: 270,
        outcome: 'ok',
        durationMs: 0,
        at: new Date('2026-12-15T10:00:00Z'),
      },
    ]);
    expect(JSON.stringify(store.calls)).not.toContain('mer');
  });

  it('usage coupé : repli, sans appel au fournisseur ni ligne de journal', async () => {
    const { provider, store, ask } = setup([reply({ text: 'x' })], settings({ enabled: false }));
    expect(await ask()).toEqual({ value: FALLBACK, source: 'fallback', outcome: 'disabled' });
    expect([provider.requests.length, store.calls.length]).toEqual([0, 0]);
  });

  it('chaque échec rend le repli : sortie hors schéma, texte qui n’est pas du JSON, erreur, délai', async () => {
    const cases: [FakeReply, string][] = [
      [reply({ text: '' }), 'invalid'],
      [reply({ text: 'ok', extra: true }), 'invalid'],
      [{ text: 'pas du JSON', inputTokens: 10, outputTokens: 5 }, 'invalid'],
      [new Error('503'), 'error'],
      ['hang', 'timeout'],
    ];
    for (const [answer, outcome] of cases) {
      const { store, ask } = setup([answer], settings({ timeoutMs: 100 }));
      expect(await ask()).toEqual({ value: FALLBACK, source: 'fallback', outcome });
      expect(store.calls.map((call) => call.outcome)).toEqual([outcome]);
    }
  });

  it('une sortie rejetée coûte quand même ses jetons ; une erreur ou un délai ne coûte rien', async () => {
    const rejected = setup([reply({ wrong: 1 }, 2000, 100)]);
    await rejected.ask();
    expect(rejected.store.calls[0]?.costMicroEuros).toBe(360);
    const failed = setup([new Error('down')]);
    await failed.ask();
    expect(failed.store.calls[0]?.costMicroEuros).toBe(0);
  });

  it('un journal en panne ne prive pas du texte : l’écriture est perdue pour la Vigie seulement', async () => {
    const provider = fakeProvider([reply({ text: 'oracle' })]);
    const broken = { record: () => Promise.reject(new Error('db down')) };
    const run = createGateway({ provider, store: broken, settings: () => settings() });
    const request = {
      usage: 'oracle' as const,
      instructions: 'x',
      data: null,
      schema: oracleSchema,
      fallback: FALLBACK,
    };
    expect(await run(request)).toEqual({ value: { text: 'oracle' }, source: 'ai', outcome: 'ok' });
  });

  it('réglages, réponse ou schéma qui lèvent : repli, jamais d’exception rendue au jeu (règle 6)', async () => {
    const request = {
      usage: 'oracle' as const,
      instructions: 'x',
      data: null,
      schema: oracleSchema,
      fallback: FALLBACK,
    };
    const store = memoryStore();
    const throwingSettings = createGateway({
      provider: fakeProvider([reply({ text: 'x' })]),
      store,
      settings: () => {
        throw new Error('config unreadable');
      },
    });
    expect(await throwingSettings(request)).toEqual({
      value: FALLBACK,
      source: 'fallback',
      outcome: 'error',
    });

    const nullReply = createGateway({
      provider: { complete: () => Promise.resolve(null as never) },
      store,
      settings: () => settings(),
    });
    expect((await nullReply(request)).outcome).toBe('error');

    const throwingSchema = z.strictObject({ text: z.string() }).refine(() => {
      throw new Error('boom');
    });
    const run = createGateway({
      provider: fakeProvider([reply({ text: 'x' })]),
      store,
      settings: () => settings(),
    });
    expect((await run({ ...request, schema: throwingSchema })).outcome).toBe('error');
  });

  it('des jetons illisibles comptent le coût de sortie le plus cher : le plafond n’est jamais désarmé', async () => {
    for (const inputTokens of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const { store, ask } = setup([{ text: '{"text":"x"}', inputTokens, outputTokens: 10 }]);
      expect((await ask()).outcome).toBe('error');
      // 300 jetons de sortie au plus × 600 µ€ le millier.
      expect(store.calls).toEqual([
        expect.objectContaining({
          outcome: 'error',
          inputTokens: 0,
          outputTokens: 300,
          costMicroEuros: 180,
        }),
      ]);
    }
  });

  it('la passerelle demande au plus les jetons de sortie de l’usage', async () => {
    const { provider, ask } = setup([reply({ text: 'x' })]);
    await ask();
    expect(provider.requests[0]?.maxOutputTokens).toBe(300);
  });

  it('un coût s’arrondit à l’unité supérieure', () => {
    expect(estimateCostMicroEuros(settings().usages.oracle, 1, 0)).toBe(1); // 0,15 µ€
    expect(estimateCostMicroEuros(settings().usages.oracle, 0, 0)).toBe(0);
  });
});

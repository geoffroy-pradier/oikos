import { createGateway, fakeProvider, memoryStore, type AiSettings } from '@oikos/ai';
import { DEFAULT_AI } from '@oikos/config';
import { chronicleFacts } from '@oikos/sim';
import { describe, expect, it } from 'vitest';
import { composeChronicle } from './compose';
import { chronicleRewriteRequest } from './rewrite';

const context = { citySlug: 'kalliste', cityNames: new Map([['nesos', 'Nèsos']]) };
const facts = chronicleFacts({
  cityId: 'kalliste',
  events: [
    { type: 'trade', cityId: 'kalliste', goodId: 'wheat', price: 6, quantity: 1500 },
    { type: 'election', cityId: 'kalliste', houseName: 'Alcméonides', votes: 3 },
    { type: 'arrival', cityId: 'kalliste', fromCityId: 'nesos' },
  ],
  worldEvents: [],
  population: { before: 1203, after: 1191 },
  maxGoods: 3,
});
const draft = composeChronicle(facts, context);
const reply = (texts: unknown) => ({
  text: JSON.stringify(texts),
  inputTokens: 10,
  outputTokens: 20,
});
const settings = (enabled: boolean): AiSettings => ({
  ...DEFAULT_AI,
  budgetMicroEurosPerActivePlayerMonth: 1_000,
  expectedActivePlayers: 100,
  usages: {
    ...DEFAULT_AI.usages,
    chronicle: { ...DEFAULT_AI.usages.chronicle, enabled, model: 'fake', capShareBps: 5_000 },
  },
});
async function rewrite(texts: unknown, enabled = true, maxTextLength = 2_000) {
  const provider = fakeProvider([reply(texts)]);
  const run = createGateway({ provider, store: memoryStore(), settings: () => settings(enabled) });
  const result = await run(chronicleRewriteRequest(facts, draft, context, maxTextLength));
  return { ...result, provider };
}

describe('réécriture par la passerelle', () => {
  it('IA coupée : la chronique de repli, sans appel au fournisseur', async () => {
    const result = await rewrite({ fr: 'Ignoré.', en: 'Ignored.' }, false);
    expect(result).toMatchObject({ value: draft, source: 'fallback', outcome: 'disabled' });
    expect(result.provider.requests).toHaveLength(0);
  });

  it('une réécriture qui ne cite que des nombres des faits est gardée, milliers de chaque langue compris', async () => {
    const texts = {
      fr: 'Grande affluence : 1 500 mesures de Blé à 6 oboles ; un navire de Nèsos. La cité perd 12 âmes, il en reste 1 191.',
      en: 'Busy agora: 1,500 measures of Wheat at 6 obols; one ship from Nèsos. The city loses 12 souls, 1,191 remain.',
    };
    expect(await rewrite(texts)).toMatchObject({ value: texts, source: 'ai', outcome: 'ok' });
  });

  it('une réécriture qui invente un chiffre ou l’écrit en lettres, même dans une seule langue, est rejetée', async () => {
    const fr = 'La maison Alcméonides est élue avec 3 voix.';
    for (const invented of [
      { fr: 'La maison Alcméonides est élue avec 4 voix.', en: 'Elected with 3 votes.' },
      { fr, en: 'Elected with 3 votes, the 5th archon of the city.' },
      { fr, en: 'Wheat sold at 6.5 obols.' },
      { fr: 'Le blé à 1 501 unités.', en: 'Elected with 3 votes.' },
      // Un nombre écrit autrement qu'en chiffres latins : en lettres, romain, fraction, milliers à l'apostrophe.
      { fr: 'Élue avec trois voix.', en: 'Elected with 3 votes.' },
      { fr, en: 'Elected with three votes.' },
      { fr: 'La IIIe archonte, élue avec 3 voix.', en: 'Elected with 3 votes.' },
      { fr, en: 'Wheat at ½ obol.' },
      { fr: "Le blé : 1'501 unités.", en: 'Elected with 3 votes.' },
    ])
      expect(await rewrite(invented)).toMatchObject({
        value: draft,
        source: 'fallback',
        outcome: 'invalid',
      });
  });

  it('une réponse vide, trop longue, sans une langue ou avec une clé de plus est rejetée', async () => {
    for (const wrong of [
      { fr: ' ', en: 'Fine.' },
      { fr: 'Bien.' },
      { fr: 'Bien.', en: 'Fine.', title: 'x' },
    ])
      expect(await rewrite(wrong)).toMatchObject({ source: 'fallback', outcome: 'invalid' });
    const long = { fr: 'a'.repeat(201), en: 'Fine.' };
    expect(await rewrite(long, true, 200)).toMatchObject({
      source: 'fallback',
      outcome: 'invalid',
    });
    expect(await rewrite({ fr: 'a'.repeat(200), en: 'Fine.' }, true, 200)).toMatchObject({
      source: 'ai',
    });
  });

  it('les noms des maisons, écrits par des joueurs, ne passent que dans le bloc de données', async () => {
    const { provider } = await rewrite({ fr: 'Bien.', en: 'Fine.' });
    const [request] = provider.requests;
    expect(request?.system).not.toContain('Alcméonides');
    expect(request?.data).toContain('Alcméonides');
    expect(request?.data).toContain('"draft"');
  });
});

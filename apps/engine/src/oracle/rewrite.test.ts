import { createGateway, fakeProvider, memoryStore, type AiSettings } from '@oikos/ai';
import { DEFAULT_AI } from '@oikos/config';
import { describe, expect, it } from 'vitest';
import { oracleCityNames } from './check';
import { fallbackOracle } from './compose';
import { oracleRewriteRequest } from './rewrite';

const event = { model: 'caravan' as const, goodId: 'wine' };
const draft = fallbackOracle({ ...event, seed: '0'.repeat(64) });
const names = oracleCityNames([{ slug: 'kalliste', name: 'Kallistè' }]);
const settings = (enabled: boolean): AiSettings => ({
  ...DEFAULT_AI,
  budgetMicroEurosPerActivePlayerMonth: 1_000,
  expectedActivePlayers: 100,
  usages: {
    ...DEFAULT_AI.usages,
    oracle: { ...DEFAULT_AI.usages.oracle, enabled, model: 'fake', capShareBps: 5_000 },
  },
});
async function rewrite(texts: unknown, enabled = true, maxTextLength = 400) {
  const provider = fakeProvider([
    { text: JSON.stringify(texts), inputTokens: 10, outputTokens: 20 },
  ]);
  const run = createGateway({ provider, store: memoryStore(), settings: () => settings(enabled) });
  const result = await run(oracleRewriteRequest(event, draft, names, maxTextLength));
  return { ...result, provider };
}
const valid = {
  fr: 'Des voix venues du levant réclameront la liqueur pourpre : Vin.',
  en: 'Voices from the east will call for the purple draught: Wine.',
};

describe('réécriture d’un oracle par la passerelle (7.3, #270)', () => {
  it('IA coupée : l’oracle de repli, sans appel au fournisseur', async () => {
    const result = await rewrite(valid, false);
    expect(result).toMatchObject({ value: draft, source: 'fallback', outcome: 'disabled' });
    expect(result.provider.requests).toHaveLength(0);
  });

  it('un oracle sans nombre ni cité, dans les deux langues, est gardé', async () => {
    expect(await rewrite(valid)).toMatchObject({ value: valid, source: 'ai', outcome: 'ok' });
  });

  it('le modèle reçoit la nature de l’événement, son bien et le repli, comme données ; ni cité ni ampleur', async () => {
    const { provider } = await rewrite(valid);
    const data = provider.requests[0]?.data ?? '';
    expect(data).toContain('"model":"caravan"');
    expect(data).toContain('"good":{"fr":"Vin","en":"Wine"}');
    expect(data).toContain(JSON.stringify(draft.fr).slice(1, 20));
    expect(data).not.toMatch(/Kallist|magnitude|city/i);
    expect(provider.requests[0]?.system).not.toContain(draft.fr);
  });

  it('un chiffre, un nombre en lettres, une cité ou une autre écriture, même dans une seule langue : le repli reste', async () => {
    for (const texts of [
      { ...valid, fr: 'Dans 3 jours, des voix réclameront le Vin.' },
      { ...valid, en: 'In three days voices will call for Wine.' },
      { ...valid, fr: 'Les marchands de Kallistè boiront le Vin.' },
      { ...valid, en: 'The merchants of K.a.l.l.i.s.t.e will drink Wine.' },
      { ...valid, fr: 'Ἀπόλλων réclamera le Vin.' },
      { ...valid, fr: 'Au premier soleil, le Vin.' },
    ]) {
      const result = await rewrite(texts);
      expect(result, JSON.stringify(texts)).toMatchObject({
        value: draft,
        source: 'fallback',
        outcome: 'invalid',
      });
    }
  });

  it('une réponse vide, trop longue, incomplète ou à champ inconnu : le repli reste', async () => {
    for (const texts of [
      { ...valid, fr: '   ' },
      { ...valid, en: 'Wine. '.repeat(20) },
      { fr: valid.fr },
      { ...valid, extra: 'x' },
      'Vin',
    ])
      expect(await rewrite(texts, true, 100)).toMatchObject({ value: draft, source: 'fallback' });
  });
});

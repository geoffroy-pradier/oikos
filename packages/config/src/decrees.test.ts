import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, validateConfig, type Decrees } from './index';

const base = () =>
  structuredClone(INITIAL_CONFIG) as Record<string, unknown> & { decrees: Decrees };
const fieldsOf = (decrees: unknown) => {
  const result = validateConfig({ ...base(), decrees });
  return result.ok ? [] : result.errors.map((error) => error.split(':')[0]);
};
const decrees = () => base().decrees;

describe('décrets (6.3)', () => {
  it('une version publiée avant les décrets reste lisible, sans section', () => {
    const older: Record<string, unknown> = base();
    delete older['decrees'];
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.decrees).toBeUndefined();
  });

  it('valeurs générales : durée du vote, quorum, décrets ouverts et plafond de dépense, bornés', () => {
    expect(fieldsOf(decrees())).toEqual([]);
    for (const [key, value] of [
      ['votingDays', 0],
      ['votingDays', 367],
      ['votingDays', 1.5],
      ['quorumBps', -1],
      ['quorumBps', 10_001],
      ['maxOpenPerCity', 0],
      ['maxOpenPerCity', 101],
      ['spendingCapShareBps', 10_001],
    ] as const)
      expect([key, value, fieldsOf({ ...decrees(), [key]: value })]).toEqual([
        key,
        value,
        [`decrees.${key}`],
      ]);
    expect(fieldsOf({ ...decrees(), quorumBps: 0, spendingCapShareBps: 0 })).toEqual([]);
  });

  it('catalogue fermé : un modèle inconnu est refusé, un modèle absent est fermé', () => {
    expect(fieldsOf({ ...decrees(), models: { ...decrees().models, embargo: {} } })).toEqual([
      'decrees.models',
    ]);
    expect(fieldsOf({ ...decrees(), models: {} })).toEqual([]);
    expect(fieldsOf({ ...decrees(), council: 1 })).toEqual(['decrees']);
  });

  it('bornes : taux au plus 50 %, coefficient au plus ×10, montant positif, minimum sous le maximum', () => {
    const models = decrees().models;
    const with_ = (patch: Partial<Decrees['models']>) =>
      fieldsOf({ ...decrees(), models: { ...models, ...patch } });
    expect(with_({ market_tax_rate: { minRateBps: 0, maxRateBps: 5001 } })).toEqual([
      'decrees.models.market_tax_rate.maxRateBps',
    ]);
    expect(with_({ market_tax_rate: { minRateBps: 600, maxRateBps: 500 } })).toEqual([
      'decrees.models.market_tax_rate.maxRateBps',
    ]);
    expect(with_({ market_tax_rate: { minRateBps: 500, maxRateBps: 500 } })).toEqual([]);
    expect(with_({ port_dues: { minCoefficientBps: 0, maxCoefficientBps: 100_001 } })).toEqual([
      'decrees.models.port_dues.maxCoefficientBps',
    ]);
    expect(with_({ port_dues: { minCoefficientBps: 2, maxCoefficientBps: 1 } })).toEqual([
      'decrees.models.port_dues.maxCoefficientBps',
    ]);
    expect(with_({ public_works: { minOboles: 0, maxOboles: 10 } })).toEqual([
      'decrees.models.public_works.minOboles',
    ]);
    expect(with_({ public_works: { minOboles: 11, maxOboles: 10 } })).toEqual([
      'decrees.models.public_works.maxOboles',
    ]);
    const festival = models.festival;
    if (!festival) throw new Error('festival expected in the initial configuration');
    expect(with_({ festival: { ...festival, minDays: 3, maxDays: 2 } })).toEqual([
      'decrees.models.festival.maxDays',
    ]);
    expect(with_({ festival: { ...festival, maxGoods: 0 } })).toEqual([
      'decrees.models.festival.maxGoods',
    ]);
    // Hausse de la demande d'une fête (#263) : de 0 à ×2, facultative (sans effet sur la demande).
    for (const demandBoostBps of [-1, 10_001, 0.5])
      expect(with_({ festival: { ...festival, demandBoostBps } })).toEqual([
        'decrees.models.festival.demandBoostBps',
      ]);
    const older = { ...festival };
    delete older.demandBoostBps;
    expect(with_({ festival: older })).toEqual([]);
    expect(with_({ festival: { ...festival, demandBoostBps: 0 } })).toEqual([]);
  });

  it('ostracisme : fermé au départ ; durées en jours de jeu et quorum bornés (6.4 ; #722)', () => {
    expect(decrees().models.ostracism).toBeUndefined();
    const ostracism = { votingDays: 3, quorumBps: 3000, ostracismDays: 7, intervalDays: 28 };
    const with_ = (patch: Partial<typeof ostracism>) =>
      fieldsOf({ ...decrees(), models: { ostracism: { ...ostracism, ...patch } } });
    expect(with_({})).toEqual([]);
    expect(with_({ quorumBps: 0, votingDays: 1, ostracismDays: 366, intervalDays: 1 })).toEqual([]);
    for (const [key, value] of [
      ['votingDays', 0],
      ['quorumBps', 10_001],
      ['ostracismDays', 367],
      ['intervalDays', 1.5],
    ] as const)
      expect(with_({ [key]: value })).toEqual([`decrees.models.ostracism.${key}`]);
    expect(fieldsOf({ ...decrees(), models: { ostracism: { ...ostracism, target: 1 } } })).toEqual([
      'decrees.models.ostracism',
    ]);
  });

  it('biens d’une fête : connus de la configuration, chacun une fois, au moins un', () => {
    const models = decrees().models;
    const festival = models.festival;
    if (!festival) throw new Error('festival expected in the initial configuration');
    const goods = (goodIds: string[]) =>
      fieldsOf({ ...decrees(), models: { ...models, festival: { ...festival, goodIds } } });
    expect(goods(['bread', 'nectar'])).toEqual(['decrees.models.festival.goodIds[1]']);
    expect(goods(['bread', 'wine', 'bread'])).toEqual(['decrees.models.festival.goodIds[2]']);
    expect(goods([])).toEqual(['decrees.models.festival.goodIds']);
  });
});

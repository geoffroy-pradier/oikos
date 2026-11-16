import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { describe, expect, it } from 'vitest';
import { groupDecrees, parseDecreeRules, parseDecrees, ratesInForce } from './decrees';

const config = INITIAL_CONFIG as GameConfig;
const decree = {
  id: 'd1',
  city_id: 'c1',
  model: 'market_tax_rate',
  params: { rateBps: 800 },
  proposed_by: 'h2',
  status: 'proposed',
  proposed_at: '2026-11-15T10:00:00+00:00',
  voting_closes_at: '2026-11-17T10:00:00+00:00',
  quorum_bps: 2000,
  tallied_at: null,
  electorate: null,
  votes_for: null,
  votes_against: null,
  applied_at: null,
};
const rules = Object.entries(config.decrees?.models ?? {}).map(([model, bounds]) => ({
  model,
  bounds,
  voting_days: 2,
  quorum_bps: 2000,
  max_open_per_city: 3,
  spending_cap_share_bps: 2500,
}));

describe('décrets de la cité (#264)', () => {
  it('lit les décrets, les plus récents d’abord, avec leur proposition validée par le contrat', () => {
    const decrees = parseDecrees([
      decree,
      {
        ...decree,
        id: 'd2',
        proposed_at: '2026-11-16T10:00:00+00:00',
        status: 'applied',
        applied_at: '2026-11-17T04:00:00+00:00',
      },
    ]);
    expect(decrees?.map((d) => d.id)).toEqual(['d2', 'd1']);
    expect(decrees?.[1]?.proposal).toEqual({ model: 'market_tax_rate', params: { rateBps: 800 } });
    expect(decrees?.[0]?.appliedAt).toBe(Date.parse('2026-11-17T04:00:00+00:00'));
  });

  it('des paramètres stockés illisibles laissent le décret lisible, sans proposition ; un état inconnu fait échouer', () => {
    expect(parseDecrees([{ ...decree, params: { rateBps: 'huit' } }])?.[0]?.proposal).toBeNull();
    expect(parseDecrees([{ ...decree, status: 'repealed' }])).toBeNull();
    expect(parseDecrees([{ ...decree, voting_closes_at: 'bientôt' }])).toBeNull();
  });

  it('regroupe : au vote, adoptés ou appliqués (en vigueur), rejetés ou caducs', () => {
    const decrees =
      parseDecrees(
        ['proposed', 'adopted', 'applied', 'rejected', 'lapsed'].map((status, index) => ({
          ...decree,
          id: status,
          status,
          proposed_at: `2026-11-1${index}T10:00:00+00:00`,
        })),
      ) ?? [];
    const groups = groupDecrees(decrees);
    expect(groups.open.map((d) => d.id)).toEqual(['proposed']);
    expect(groups.passed.map((d) => d.id)).toEqual(['applied', 'adopted']);
    expect(groups.other.map((d) => d.id)).toEqual(['lapsed', 'rejected']);
  });

  it('règles : bornes de chaque modèle ouvert, règles communes ; aucune ligne, aucun modèle', () => {
    const read = parseDecreeRules(rules);
    expect(read?.models.sort()).toEqual([
      'festival',
      'market_tax_rate',
      'port_dues',
      'public_works',
    ]);
    expect(read?.bounds.market_tax_rate).toEqual({ minRateBps: 200, maxRateBps: 1000 });
    expect(read?.bounds.festival?.goodIds).toContain('bread');
    expect(read).toMatchObject({
      votingDays: 2,
      quorumBps: 2000,
      maxOpenPerCity: 3,
      spendingCapShareBps: 2500,
    });
    expect(parseDecreeRules([])).toMatchObject({ models: [] });
    expect(parseDecreeRules([{ ...rules[0], model: 'embargo' }])?.models).toEqual([]);
    expect(
      parseDecreeRules([
        { ...rules[0], model: 'market_tax_rate', bounds: { minRateBps: 900, maxRateBps: 100 } },
      ]),
    ).toBeNull();
  });
  it('en vigueur : le dernier décret appliqué de chaque modèle de taux, jamais une dépense', () => {
    const applied = (id: string, model: string, params: unknown, at: string) => ({
      ...decree,
      id,
      model,
      params,
      status: 'applied',
      applied_at: at,
    });
    const decrees =
      parseDecrees([
        applied('old', 'market_tax_rate', { rateBps: 500 }, '2026-11-10T04:00:00+00:00'),
        applied('new', 'market_tax_rate', { rateBps: 700 }, '2026-11-12T04:00:00+00:00'),
        applied('port', 'port_dues', { coefficientBps: 12000 }, '2026-11-11T04:00:00+00:00'),
        applied('works', 'public_works', { amountOboles: 600 }, '2026-11-13T04:00:00+00:00'),
        { ...decree, id: 'voting', status: 'proposed' },
      ]) ?? [];
    expect([...ratesInForce(decrees)].sort()).toEqual(['new', 'port']);
  });
});

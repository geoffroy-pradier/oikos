import { describe, expect, it } from 'vitest';
import {
  draftOf,
  blankRule,
  goodsFor,
  hireIntent,
  instructionIntent,
  moveUp,
  parseInstructions,
  parseStewardActivity,
  parseStewards,
  rulesIntent,
  rulesOf,
  staleIntents,
  type RuleDraft,
} from './stewards';

const hired = '2026-11-18T10:00:00.000Z';
const row = (id: string, siteId: string, unpaidSince: string | null) => ({
  id,
  site_id: siteId,
  name: `Intendant ${id}`,
  hired_at: hired,
  unpaid_since: unpaidSince,
  rules_revision: 2,
});
const rule = (stewardId: string, position: number, kind: string, extra = {}) => ({
  steward_id: stewardId,
  position,
  kind,
  good_id: null,
  price_oboles: null,
  units: null,
  ...extra,
});

describe('intendants de la maison (#278)', () => {
  it('par site, avec leur état et leurs règles dans l’ordre ; une ligne illisible est ignorée', () => {
    const stewards = parseStewards(
      [
        row('a', 's1', null),
        row('b', 's2', hired),
        row('c', 's3', '2026-11-19T03:00:00.000Z'),
        { id: 'x' },
      ],
      [
        rule('a', 1, 'buy', { good_id: 'wheat', price_oboles: '7', units: '50' }),
        rule('a', 0, 'sell', { good_id: 'flour', price_oboles: 14, units: 0 }),
        rule('a', 2, 'transport'),
        rule('b', 0, 'collect'),
        rule('a', 3, 'sell', { good_id: 'flour', price_oboles: 0, units: 1 }),
      ],
    );
    expect([...stewards.keys()]).toEqual(['s1', 's2', 's3']);
    expect(stewards.get('s1')).toMatchObject({
      id: 'a',
      state: 'active',
      since: null,
      revision: 2,
    });
    expect(stewards.get('s1')?.rules).toEqual([
      { kind: 'sell', goodId: 'flour', minPriceOboles: 14, keepUnits: 0 },
      { kind: 'buy', goodId: 'wheat', maxPriceOboles: 7, targetUnits: 50 },
    ]);
    expect(stewards.get('s2')).toMatchObject({ state: 'hired', rules: [{ kind: 'collect' }] });
    expect(stewards.get('s3')).toMatchObject({ state: 'unpaid', rules: [] });
    expect(stewards.get('s3')?.since).toEqual(new Date('2026-11-19T03:00:00.000Z'));
  });

  it('saisie : la grammaire du contrat, les nombres en chiffres, la première ligne fautive nommée', () => {
    const drafts: RuleDraft[] = [
      { kind: 'collect', goodId: 'ignored', price: '9', units: '9' },
      { kind: 'sell', goodId: 'flour', price: ' 14 ', units: '0' },
      { kind: 'buy', goodId: 'wheat', price: '7', units: '50' },
    ];
    const rules = [
      { kind: 'collect' },
      { kind: 'sell', goodId: 'flour', minPriceOboles: 14, keepUnits: 0 },
      { kind: 'buy', goodId: 'wheat', maxPriceOboles: 7, targetUnits: 50 },
    ];
    expect(rulesOf(drafts)).toEqual({ rules });
    expect(rulesOf([])).toEqual({ rules: [] });
    expect(rules.map((one) => rulesOf([draftOf(one as never)]))).toEqual(
      rules.map((one) => ({ rules: [one] })),
    );
    for (const [index, changed] of [
      [1, { price: '14,5' }],
      [1, { price: '0' }],
      [2, { units: '0' }],
      [2, { units: '' }],
      [1, { goodId: '' }],
      [2, { price: '1e3' }],
    ] as const)
      expect(
        rulesOf(drafts.map((draft, rank) => (rank === index ? { ...draft, ...changed } : draft))),
      ).toEqual({ invalid: index });
    expect(rulesOf([...drafts, drafts[1] as RuleDraft])).toEqual({ invalid: 3 });
  });

  it('formulaire : un rachat vise les intrants, une vente aussi les extrants ; les règles se réordonnent', () => {
    const mill = { inputs: [{ goodId: 'wheat' }], outputs: [{ goodId: 'flour' }] };
    expect(goodsFor(mill, { kind: 'buy', goodId: '' })).toEqual(['wheat']);
    expect(goodsFor(mill, { kind: 'sell', goodId: '' })).toEqual(['flour', 'wheat']);
    expect(goodsFor(mill, { kind: 'sell', goodId: 'olives' })).toEqual([
      'olives',
      'flour',
      'wheat',
    ]);
    expect(goodsFor(null, { kind: 'buy', goodId: '' })).toEqual([]);
    expect(blankRule(mill, 'buy')).toEqual({ kind: 'buy', goodId: 'wheat', price: '', units: '' });
    expect(blankRule(mill, 'collect').goodId).toBe('');
    expect(moveUp(['a', 'b', 'c'], 2)).toEqual(['a', 'c', 'b']);
    expect(moveUp(['a', 'b', 'c'], 0)).toEqual(['a', 'b', 'c']);
    expect(moveUp(['a', 'b'], 5)).toEqual(['a', 'b']);
  });

  it('intentions : l’embauche caduque dès que l’intendant est lu, les règles d’une révision dépassée', () => {
    const steward = { id: 'st1', revision: 3 };
    const [hire, old, current] = [
      hireIntent('s1'),
      rulesIntent({ ...steward, revision: 2 }, []),
      rulesIntent(steward, []),
    ];
    expect(current).toBe('rules:st1:3:[]');
    expect(
      [hire, old, current, hireIntent('s2'), 'rules:st2:1:[]'].filter(staleIntents('s1', steward)),
    ).toEqual([hire, old]);
    // Sans intendant lu, rien n'est caduc : une embauche sans réponse repart sous sa clé.
    expect([hire, old].filter(staleIntents('s1', undefined))).toEqual([]);
  });

  it('opérations (#279) : les cinq dernières par intendant, la plus récente d’abord, et le dernier refus', () => {
    const op = (stewardId: string, tick: number | string, extra = {}) => ({
      steward_id: stewardId,
      tick_index: tick,
      rank: 0,
      created_at: hired,
      status: 'ok',
      error_code: null,
      kind: 'collect',
      good_id: null,
      summary: { command: 'site.collect', cycles: 1, outputs: [{ goodId: 'wheat', quantity: 40 }] },
      ...extra,
    });
    const refused = {
      status: 'rejected',
      error_code: 'INSUFFICIENT_FUNDS',
      kind: 'buy',
      good_id: 'wheat',
      summary: {
        command: 'market.placeOrder',
        side: 'buy',
        goodId: 'wheat',
        price: 7,
        quantity: 50,
      },
    };
    const activity = parseStewardActivity([
      op('st1', 1, refused),
      ...[2, 3, 4, 5, 6].map((tick) => op('st1', String(tick))),
      op('st1', 6, { rank: 1, kind: 'sell' }),
      op('st2', 9, refused),
      op('st2', 'illisible'),
      { ...op('st2', 10), summary: { command: 'steward.hire' } },
    ]);
    const first = activity.get('st1');
    expect(first?.recent.map((operation) => operation.kind)).toEqual([
      'sell',
      'collect',
      'collect',
      'collect',
      'collect',
    ]);
    expect(first?.lastRefusal).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      kind: 'buy',
      goodId: 'wheat',
    });
    expect(activity.get('st2')?.recent).toHaveLength(1);
    expect(activity.get('st2')?.lastRefusal).toBe(activity.get('st2')?.recent[0]);
    expect(parseStewardActivity([]).size).toBe(0);
  });
});

describe('consigne d’un intendant (#280)', () => {
  const sell = { kind: 'sell', goodId: 'flour', minPriceOboles: 14, keepUnits: 0 };
  const answered = {
    steward_id: 'a',
    rules_revision: 2,
    text: 'vends la farine',
    status: 'answered',
    rules: [sell],
    simulation: [{ position: 0, status: 'idle' }],
    refusal: null,
  };
  it('lit la dernière consigne de chaque intendant, sa proposition et sa simulation', () => {
    const read = parseInstructions([
      answered,
      { ...answered, steward_id: 'b', status: 'pending', rules: null, simulation: null },
      {
        ...answered,
        steward_id: 'c',
        text: null,
        rules: null,
        simulation: null,
        refusal: 'AI_UNAVAILABLE',
      },
    ]);
    expect(read.get('a')).toEqual({
      stewardId: 'a',
      revision: 2,
      text: 'vends la farine',
      status: 'answered',
      rules: [sell],
      simulation: [{ position: 0, status: 'idle' }],
      refusal: null,
    });
    expect(read.get('b')?.status).toBe('pending');
    expect(read.get('c')).toMatchObject({ text: null, refusal: 'AI_UNAVAILABLE' });
  });

  it('ignore une proposition hors de la grammaire ou un refus inconnu ; une simulation illisible est tue', () => {
    const read = parseInstructions([
      { ...answered, rules: [{ kind: 'transfer' }] },
      { ...answered, steward_id: 'b', rules: null, simulation: null, refusal: 'TRANSFER_DONE' },
      { ...answered, steward_id: 'c', simulation: [{ position: 0, status: 'done' }] },
    ]);
    expect([...read.keys()]).toEqual(['c']);
    expect(read.get('c')?.simulation).toBeNull();
  });

  it('une consigne d’une révision passée est caduque', () => {
    const steward = { id: 'a', revision: 2 };
    const stale = staleIntents('s1', { id: 'a', revision: 3 });
    expect(stale(instructionIntent(steward, 'vends'))).toBe(true);
    expect(staleIntents('s1', steward)(instructionIntent(steward, 'vends'))).toBe(false);
  });
});

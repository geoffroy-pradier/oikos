import { describe, expect, it } from 'vitest';
import {
  liturgyHonor,
  liturgyState,
  openLiturgy,
  parseCityLiturgies,
  parseLiturgyRules,
  parseMyLiturgies,
  quoteLiturgy,
  splendorLimit,
} from './liturgies';

const mine = (
  id: string,
  season: number,
  status = 'assigned',
  dueAt = '2026-11-24T04:00:00+00:00',
) => ({
  id,
  city_id: 'c1',
  season,
  genre: 'festival',
  due: 6000,
  due_at: dueAt,
  status,
});
const rules = { honorGain: 40, charisGain: 25, evasionHonorLoss: 90, maxSplendorBps: 5000 };
const DUE_AT = Date.parse('2026-11-24T04:00:00+00:00');

describe('liturgies de la maison', () => {
  it('range par saison décroissante et refuse une ligne illisible', () => {
    expect(parseMyLiturgies([mine('a', 1), mine('b', 3)])?.map((row) => row.id)).toEqual([
      'b',
      'a',
    ]);
    expect(parseMyLiturgies([{ ...mine('a', 1), genre: 'inconnu' }])).toBeNull();
    expect(parseMyLiturgies([{ ...mine('a', 1), due: 0 }])).toBeNull();
    expect(parseMyLiturgies([{ ...mine('a', 1), due_at: 'hier' }])).toBeNull();
  });

  it('une désignée est échue dès l’instant de son échéance, une réglée garde son état', () => {
    const [open] = parseMyLiturgies([mine('a', 1)]) ?? [];
    expect(open && liturgyState(open, DUE_AT - 1)).toBe('assigned');
    expect(open && liturgyState(open, DUE_AT)).toBe('overdue');
    for (const status of ['performed', 'levied'] as const)
      expect(liturgyState({ status, dueAt: DUE_AT }, DUE_AT - 1)).toBe(status);
  });

  it('la liturgie à accomplir est la désignée pas encore échue, jamais une échue ou une réglée', () => {
    const list = parseMyLiturgies([mine('old', 1), mine('new', 2, 'performed')]) ?? [];
    expect(openLiturgy(list, DUE_AT - 1)?.id).toBe('old');
    expect(openLiturgy(list, DUE_AT)).toBeNull();
    expect(openLiturgy(parseMyLiturgies([mine('x', 1, 'levied')]) ?? [], 0)).toBeNull();
  });
});

describe('liturgies de la cité', () => {
  const row = (house: string, season: number, status = 'assigned') => ({
    house_id: house,
    season,
    genre: 'choregia',
    status,
    due_at: '2026-11-24T04:00:00+00:00',
  });

  it('ne garde que la saison la plus récente, et ne porte aucun montant', () => {
    const list = parseCityLiturgies([row('h1', 1), row('h2', 2), row('h3', 2, 'levied')]);
    expect(list?.map((entry) => entry.houseId)).toEqual(['h2', 'h3']);
    expect(Object.keys(list?.[0] ?? {}).sort()).toEqual([
      'dueAt',
      'genre',
      'houseId',
      'season',
      'status',
    ]);
    expect(parseCityLiturgies([])).toEqual([]);
    expect(parseCityLiturgies([{ ...row('h1', 1), status: 'x' }])).toBeNull();
  });
});

describe('annonce de l’accomplissement', () => {
  it('lit les règles publiques, ou refuse une ligne qui n’en a pas la forme', () => {
    expect(parseLiturgyRules({ rules })).toEqual(rules);
    expect(parseLiturgyRules(null)).toBeNull();
    expect(parseLiturgyRules({ rules: { ...rules, maxSplendorBps: 10_001 } })).toBeNull();
    expect(parseLiturgyRules({ rules: { honorGain: 1 } })).toBeNull();
  });

  it('borne le faste à la part du dû, arrondie à l’obole inférieure ; zéro sans borne', () => {
    expect(splendorLimit(6001, rules)).toBe(3000);
    expect(splendorLimit(6000, { ...rules, maxSplendorBps: 0 })).toBe(0);
  });

  it('les gains suivent la formule de la simulation : le double avec un faste égal au dû', () => {
    expect(quoteLiturgy(6000, 0, { ...rules, maxSplendorBps: 10_000 })).toEqual({
      total: 6000,
      honor: 40,
      charis: 25,
    });
    expect(quoteLiturgy(6000, 6000, { ...rules, maxSplendorBps: 10_000 })).toEqual({
      total: 12_000,
      honor: 80,
      charis: 50,
    });
    expect(quoteLiturgy(6000, 3001, rules)).toBeNull();
    expect(quoteLiturgy(6000, -1, rules)).toBeNull();
    expect(quoteLiturgy(6000, 1.5, rules)).toBeNull();
  });
});

describe('Timè d’une liturgie réglée', () => {
  const entries = [
    { amount: -90, reason: 'liturgy_evaded', reference: 'a' },
    { amount: 40, reason: 'liturgy_performed', reference: 'b' },
    { amount: 5, reason: 'archon_term', reference: 'a' },
  ];

  it('prend la ligne de cette liturgie et de ce motif, perte négative comprise', () => {
    expect(liturgyHonor(entries, 'a')).toBe(-90);
    expect(liturgyHonor(entries, 'b')).toBe(40);
    expect(liturgyHonor(entries, 'c')).toBe(0);
    expect(liturgyHonor([{ amount: 'x' }], 'a')).toBeNull();
  });
});

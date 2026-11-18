import { describe, expect, it } from 'vitest';
import {
  acceptsOfferings,
  charisByGod,
  charisIntent,
  charisIntentStale,
  offeringQuote,
  parseCityCharis,
  parseFavor,
  parseTempleRules,
} from './temple';

describe('règles des temples (#272)', () => {
  it('un dieu d’une version publiée avant la Charis prend les valeurs par défaut du schéma', () => {
    const rules = parseTempleRules({
      gods: [
        { id: 'demeter', charisPerObole: 1, charisPerUnit: { wheat: 5 }, dailyDecayBps: 100 },
        { id: 'old' },
      ],
    });
    expect(rules?.gods[1]).toEqual({
      id: 'old',
      charisPerObole: 0,
      charisPerUnit: {},
      dailyDecayBps: 0,
    });
  });

  it('aucune ligne : aucun dieu ; une ligne illisible : null', () => {
    expect(parseTempleRules(null)).toEqual({ gods: [] });
    expect(parseTempleRules({ gods: [{ id: 'demeter', dailyDecayBps: 20_000 }] })).toBeNull();
  });

  it('Charis par dieu : nulle sans ligne, déclin du jour arrondi vers zéro comme la clôture', () => {
    const rules = parseTempleRules({
      gods: [
        { id: 'demeter', dailyDecayBps: 100 },
        { id: 'athena', dailyDecayBps: 100 },
        { id: 'apollo', dailyDecayBps: 0 },
      ],
    });
    const favor = parseFavor(
      [
        { house_id: 'h1', god_id: 'demeter', charis: 1_250 },
        { house_id: 'h1', god_id: 'athena', charis: 99 },
        { house_id: 'h2', god_id: 'apollo', charis: 5_000 },
      ],
      'h1',
    );
    if (!rules || !favor) throw new Error('lecture attendue');
    expect(
      charisByGod(rules, favor).map(({ god, charis, decay }) => [god.id, charis, decay]),
    ).toEqual([
      ['demeter', 1_250, 12],
      ['athena', 99, 0],
      ['apollo', 0, 0],
    ]);
    expect(parseFavor([{ house_id: 'h1', god_id: 'demeter', charis: -1 }], 'h1')).toBeNull();
  });

  it('Charis de cité : celle de la cité de la maison, absente sans dieu protecteur', () => {
    const rows = [
      { city_id: 'c1', god_id: 'athena', charis: 300 },
      { city_id: 'c2', god_id: 'poseidon', charis: 7 },
    ];
    expect(parseCityCharis(rows, 'c1')).toEqual({ godId: 'athena', charis: 300 });
    expect(parseCityCharis(rows, 'c3')).toBeUndefined();
    expect(parseCityCharis([{ city_id: 'c1', god_id: 'athena', charis: 1.5 }], 'c1')).toBeNull();
  });
});

describe('Charis d’une offrande annoncée (#272)', () => {
  const [demeter, apollo] =
    parseTempleRules({ gods: [{ id: 'demeter', charisPerUnit: { wheat: 5 } }, { id: 'apollo' }] })
      ?.gods ?? [];
  it('le calcul de l’API ; rien pour une offrande vide, refusée ou hors des entiers sûrs', () => {
    if (!demeter || !apollo) throw new Error('dieux attendus');
    expect(acceptsOfferings(demeter)).toBe(true);
    expect(acceptsOfferings(apollo)).toBe(false);
    expect(offeringQuote(demeter, { oboles: 0, goods: [{ goodId: 'wheat', quantity: 7 }] })).toBe(
      35,
    );
    expect(offeringQuote(demeter, { oboles: 0, goods: [] })).toBeNull();
    expect(offeringQuote(demeter, { oboles: 3, goods: [] })).toBeNull();
    const huge = { goodId: 'wheat', quantity: Number.MAX_SAFE_INTEGER };
    expect(offeringQuote(demeter, { oboles: 0, goods: [huge] })).toBeNull();
  });
});

describe('intention comptée sur la Charis (#272)', () => {
  it('caduque dès que la Charis relue envers son dieu n’est plus celle de la demande', () => {
    const intent = charisIntent('offering', 'demeter', 100, '{"oboles":12}');
    expect(charisIntentStale('offering', new Map([['demeter', 100]]))(intent)).toBe(false);
    expect(charisIntentStale('offering', new Map([['demeter', 112]]))(intent)).toBe(true);
    expect(charisIntentStale('oracle', new Map())(intent)).toBe(false);
    expect(charisIntentStale('oracle', new Map())(charisIntent('oracle', 'apollo', 60))).toBe(true);
  });
});

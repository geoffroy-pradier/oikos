import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import { nemesisAvertedSchema, nemesisStruckSchema, omenReceivedSchema } from './nemesis';

const OMEN = '01900000-0000-7000-8000-0000000735a0';
const HOUSE = '01900000-0000-7000-8000-0000000735a1';

describe('présages et Némésis (#735)', () => {
  it('les trois événements se relisent tels qu’ils sont écrits, par leur schéma comme par l’union', () => {
    const received = {
      type: 'OmenReceived' as const,
      payload: {
        omenId: OMEN,
        houseId: HOUSE,
        model: 'lawsuit' as const,
        omenDay: 20_780,
        dueDay: 20_783,
      },
    };
    const struck = {
      type: 'NemesisStruck' as const,
      payload: {
        omenId: OMEN,
        houseId: HOUSE,
        model: 'warehouse_fire' as const,
        gameDay: 20_783,
        magnitudeBps: 1_750,
        oboles: null,
        inventoryId: '01900000-0000-7000-8000-0000000735c1',
        goodId: 'wheat',
        quantity: 17,
        siteId: null,
        resumesAt: null,
        voyageId: null,
      },
    };
    const averted = {
      type: 'NemesisAverted' as const,
      payload: { omenId: OMEN, houseId: HOUSE, model: 'ship_lost' as const, gameDay: 20_784 },
    };
    for (const [schema, event] of [
      [omenReceivedSchema, received],
      [nemesisStruckSchema, struck],
      [nemesisAvertedSchema, averted],
    ] as const) {
      const written = JSON.parse(JSON.stringify(event)) as unknown;
      expect(schema.parse(written)).toEqual(event);
      expect(domainEventSchema.parse(written)).toEqual(event);
    }
  });

  it('refuse un modèle inconnu, une échéance qui ne suit pas le présage, une ampleur hors bornes, un champ de plus', () => {
    const received = { omenId: OMEN, houseId: HOUSE, model: 'lawsuit', omenDay: 10, dueDay: 13 };
    const ok = (type: string, payload: unknown) =>
      domainEventSchema.safeParse({ type, payload }).success;
    expect(ok('OmenReceived', received)).toBe(true);
    expect(ok('OmenReceived', { ...received, model: 'plague' })).toBe(false);
    expect(ok('OmenReceived', { ...received, dueDay: 10 })).toBe(false);
    expect(ok('OmenReceived', { ...received, gauge: 12 })).toBe(false);
    const struck = {
      omenId: OMEN,
      houseId: HOUSE,
      model: 'lawsuit',
      gameDay: 13,
      magnitudeBps: 500,
      oboles: 0,
      inventoryId: null,
      goodId: null,
      quantity: null,
      siteId: null,
      resumesAt: null,
      voyageId: null,
    };
    expect(ok('NemesisStruck', struck)).toBe(true);
    expect(ok('NemesisStruck', { ...struck, magnitudeBps: 10_001 })).toBe(false);
    expect(ok('NemesisStruck', { ...struck, oboles: -1 })).toBe(false);
    expect(ok('NemesisStruck', { ...struck, relief: 5 })).toBe(false);
  });
});

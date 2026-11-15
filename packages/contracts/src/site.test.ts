import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import { siteAcquireInputSchema, siteRestartInputSchema, upkeepSettledSchema } from './site';

const HOUSE = '01900000-0000-7000-8000-0000000000a1';
const [FIELD, QUARRY] = [
  '01900000-0000-7000-8000-0000000003f1',
  '01900000-0000-7000-8000-0000000003f2',
];

describe('UpkeepSettled', () => {
  // Une clôture : le champ est payé (38), la carrière reste impayée (75) et s'arrête ; un site sans
  // tarif à l'arrêt repart sans payer.
  const settled = {
    type: 'UpkeepSettled' as const,
    payload: {
      houseId: HOUSE,
      gameDay: 20_771,
      paidOboles: 38,
      paid: [{ siteId: FIELD, oboles: 38 }],
      unpaid: [{ siteId: QUARRY, oboles: 75 }],
      halted: [QUARRY],
      resumed: ['01900000-0000-7000-8000-0000000003f3'],
    },
  };

  it('aller-retour : l’événement se relit tel qu’il est écrit, par son schéma comme par l’union', () => {
    const written = JSON.parse(JSON.stringify(upkeepSettledSchema.parse(settled))) as unknown;
    expect(upkeepSettledSchema.parse(written)).toEqual(settled);
    expect(domainEventSchema.parse(written)).toEqual(settled);
    // Une maison dont rien n'a été payé, ni arrêté : listes vides, montant nul.
    const nothing = {
      ...settled,
      payload: { ...settled.payload, paidOboles: 0, paid: [], halted: [], resumed: [] },
    };
    expect(domainEventSchema.parse(nothing)).toEqual(nothing);
  });

  it('rejette un montant négatif ou fractionnaire, un jour invalide, un identifiant mal formé, un champ en trop ou manquant', () => {
    const { payload } = settled;
    const broken = [
      { ...payload, paidOboles: -1 },
      { ...payload, paidOboles: 1.5 },
      { ...payload, gameDay: -1 },
      { ...payload, paid: [{ siteId: FIELD, oboles: -38 }] },
      { ...payload, unpaid: [{ siteId: 'champ', oboles: 75 }] },
      { ...payload, halted: ['carrière'] },
      { ...payload, houseId: 'maison' },
      { ...payload, userId: HOUSE },
      { ...payload, paid: [{ siteId: FIELD, oboles: 38, note: 'en retard' }] },
      (({ resumed: _resumed, ...rest }) => rest)(payload),
    ];
    for (const candidate of broken) {
      expect(upkeepSettledSchema.safeParse({ ...settled, payload: candidate }).success).toBe(false);
      expect(domainEventSchema.safeParse({ ...settled, payload: candidate }).success).toBe(false);
    }
    expect(domainEventSchema.safeParse({ ...settled, type: 'UpkeepPaid' }).success).toBe(false);
  });
});

describe('prix attendu des commandes de site', () => {
  it('facultatif pour un client antérieur ; entier, positif pour une acquisition, nul permis pour une relance', () => {
    const recipeId = 'grow_wheat';
    expect(siteAcquireInputSchema.parse({ recipeId })).toEqual({ recipeId });
    expect(siteAcquireInputSchema.safeParse({ recipeId, expectedCostOboles: 1000 }).success).toBe(
      true,
    );
    for (const expectedCostOboles of [0, -1, 1.5, '1000'])
      expect(siteAcquireInputSchema.safeParse({ recipeId, expectedCostOboles }).success).toBe(
        false,
      );
    expect(siteRestartInputSchema.parse({ siteId: FIELD })).toEqual({ siteId: FIELD });
    expect(
      siteRestartInputSchema.safeParse({ siteId: FIELD, expectedUpkeepOboles: 0 }).success,
    ).toBe(true);
    for (const expectedUpkeepOboles of [-1, 0.5, null])
      expect(
        siteRestartInputSchema.safeParse({ siteId: FIELD, expectedUpkeepOboles }).success,
      ).toBe(false);
  });
});

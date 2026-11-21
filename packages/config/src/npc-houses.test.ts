import { describe, expect, it } from 'vitest';
import {
  INITIAL_CONFIG,
  MAX_NPC_HOUSE_SITES,
  validateConfig,
  type NpcChain,
  type NpcHouses,
} from './index';

const errorsOf = (npcHouses: unknown) => {
  const result = validateConfig({ ...(structuredClone(INITIAL_CONFIG) as object), npcHouses });
  return result.ok ? [] : result.errors;
};
const fieldsOf = (npcHouses: unknown) => errorsOf(npcHouses).map((error) => error.split(':')[0]);
/** Filière de Kallistè : le blé et la farine. */
const bread = (change: Partial<NpcChain> = {}): NpcChain => ({
  id: 'bread',
  name: 'Greniers de Kallistè',
  sites: { grow_wheat: 2, mill_flour: 1 },
  grantOboles: 8_000,
  ...change,
});
/** Filière d'Elaia : le blé seul, sans dotation. */
const wheat = (change: Partial<NpcChain> = {}): NpcChain => ({
  id: 'bread',
  name: "Greniers d'Elaia",
  sites: { grow_wheat: 1 },
  grantOboles: 0,
  ...change,
});
/** Une filière valide par cité ; `elaia` change celle d'Elaia, `cap` son plafond. */
const houses = (elaia: Partial<NpcChain> = {}, cap = 0): NpcHouses => ({
  kalliste: { treasuryCapOboles: 20_000, chains: [bread()] },
  elaia: { treasuryCapOboles: cap, chains: [wheat(elaia)] },
});

describe('maisons PNJ de secours (8.3, #715)', () => {
  it('vide dans la configuration initiale, et absente d’une version publiée avant elles', () => {
    const initial = validateConfig(INITIAL_CONFIG);
    if (!initial.ok) throw new Error(initial.errors.join('\n'));
    expect(initial.config.npcHouses).toEqual({});
    const older = structuredClone(INITIAL_CONFIG) as Record<string, unknown>;
    delete older['npcHouses'];
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.npcHouses).toEqual({});
  });

  it('des filières par cité, recettes, nombre de sites, dotation et plafond, dotation nulle comprise', () => {
    expect(errorsOf(houses())).toEqual([]);
    // Dotation égale au plafond : admise ; une obole de plus : refusée.
    expect(errorsOf(houses({ grantOboles: 5 }, 5))).toEqual([]);
    expect(errorsOf(houses({ grantOboles: 6 }, 5))).toEqual([
      'npcHouses.elaia.chains[0].grantOboles: above the treasury cap',
    ]);
  });

  it('des cités, des recettes et des terroirs connus', () => {
    const config = {
      kalliste: {
        treasuryCapOboles: 20_000,
        chains: [bread({ sites: { grow_gold: 1, rake_salt: 1, mill_flour: 1 } })],
      },
      thera: { treasuryCapOboles: 1, chains: [] },
    };
    expect(errorsOf(config)).toEqual([
      'npcHouses.kalliste.chains[0].sites.grow_gold: unknown recipe "grow_gold"',
      // Kallistè n'a pas de salines ; l'atelier est admis partout.
      'npcHouses.kalliste.chains[0].sites.rake_salt: the recipe "rake_salt" is not in the terroir',
      'npcHouses.thera: unknown city "thera"',
    ]);
  });

  it('une filière unique dans sa cité, un nom unique dans le monde, sans égard à la casse', () => {
    const config = {
      kalliste: {
        treasuryCapOboles: 20_000,
        chains: [bread(), wheat({ name: "greniers d'elaia" })],
      },
      elaia: { treasuryCapOboles: 0, chains: [wheat()] },
    };
    expect(errorsOf(config)).toEqual([
      'npcHouses.kalliste.chains[1].id: duplicate id "bread"',
      // Elaia vient après Kallistè : son nom est le doublon.
      'npcHouses.elaia.chains[0].name: duplicate house name "Greniers d\'Elaia"',
    ]);
  });

  it('au moins un site, au plus le plafond technique ; des nombres entiers positifs', () => {
    expect(errorsOf(houses({ sites: {} }))).toEqual([
      'npcHouses.elaia.chains[0].sites: at least one site',
    ]);
    expect(errorsOf(houses({ sites: { grow_wheat: MAX_NPC_HOUSE_SITES } }))).toEqual([]);
    expect(errorsOf(houses({ sites: { grow_wheat: MAX_NPC_HOUSE_SITES, fell_wood: 1 } }))).toEqual([
      `npcHouses.elaia.chains[0].sites: at most ${MAX_NPC_HOUSE_SITES} sites`,
    ]);
    for (const bad of [0, -1, 1.5, MAX_NPC_HOUSE_SITES + 1])
      expect([bad, fieldsOf(houses({ sites: { grow_wheat: bad } }))]).toEqual([
        bad,
        expect.arrayContaining(['npcHouses.elaia.chains[0].sites.grow_wheat']),
      ]);
  });

  it('un nom de maison valide ; des montants entiers, positifs ou nuls, bornés', () => {
    for (const name of ['Ab', ' Greniers', 'Greniers 2', 'G'.repeat(25)])
      expect([name, fieldsOf(houses({ name }))]).toEqual([
        name,
        ['npcHouses.elaia.chains[0].name'],
      ]);
    for (const bad of [-1, 0.5, 1_000_000_001]) {
      expect([bad, fieldsOf(houses({}, bad))]).toEqual([
        bad,
        expect.arrayContaining(['npcHouses.elaia.treasuryCapOboles']),
      ]);
      expect([bad, fieldsOf(houses({ grantOboles: bad }, 1_000_000_000))]).toEqual([
        bad,
        expect.arrayContaining(['npcHouses.elaia.chains[0].grantOboles']),
      ]);
    }
  });

  describe('règles des sites (#716)', () => {
    /** Le champ récolte et vend son blé au prix de référence (6) ; le moulin rachète du blé et vend sa farine (10). */
    const RULES: NpcChain['rules'] = {
      grow_wheat: [
        { kind: 'collect' },
        { kind: 'sell', goodId: 'wheat', minPriceOboles: 6, keepUnits: 0 },
      ],
      mill_flour: [
        { kind: 'buy', goodId: 'wheat', maxPriceOboles: 6, targetUnits: 40 },
        { kind: 'collect' },
        { kind: 'sell', goodId: 'flour', minPriceOboles: 9, keepUnits: 8 },
      ],
    };
    const ruled = (rules: unknown) => ({
      kalliste: { treasuryCapOboles: 20_000, chains: [bread({ rules } as Partial<NpcChain>)] },
    });

    it('récolte, vente au prix de référence ou moins, achat d’un intrant : admis', () => {
      expect(errorsOf(ruled(RULES))).toEqual([]);
      const result = validateConfig({
        ...(structuredClone(INITIAL_CONFIG) as object),
        npcHouses: ruled(RULES),
      });
      expect(result.ok && result.config.npcHouses['kalliste']?.chains[0]?.rules).toEqual(RULES);
      // Absentes (filière de #715) ou vides : admises, ses sites ne font rien.
      expect(errorsOf(ruled({}))).toEqual([]);
      expect(errorsOf(ruled({ grow_wheat: [] }))).toEqual([]);
    });

    it('le schéma refuse une vente au-dessus du prix de référence, d’une obole', () => {
      expect(
        errorsOf(
          ruled({
            grow_wheat: [{ kind: 'sell', goodId: 'wheat', minPriceOboles: 7, keepUnits: 0 }],
          }),
        ),
      ).toEqual([
        'npcHouses.kalliste.chains[0].rules.grow_wheat[0].minPriceOboles: above the reference price (6)',
      ]);
    });

    it('le schéma refuse un achat d’intrant au-dessus du prix de référence, d’une obole (#717)', () => {
      expect(
        errorsOf(
          ruled({
            mill_flour: [{ kind: 'buy', goodId: 'wheat', maxPriceOboles: 7, targetUnits: 40 }],
          }),
        ),
      ).toEqual([
        'npcHouses.kalliste.chains[0].rules.mill_flour[0].maxPriceOboles: above the reference price (6)',
      ]);
    });

    it('un achat d’un intrant de la recette, des biens connus, une recette de la filière, une règle par sorte et par bien', () => {
      expect(
        errorsOf(
          ruled({
            grow_wheat: [
              { kind: 'buy', goodId: 'wheat', maxPriceOboles: 6, targetUnits: 1 },
              { kind: 'sell', goodId: 'gold', minPriceOboles: 1, keepUnits: 0 },
              { kind: 'collect' },
              { kind: 'collect' },
            ],
            bake_bread: [{ kind: 'collect' }],
          }),
        ),
      ).toEqual([
        'npcHouses.kalliste.chains[0].rules.grow_wheat[0].goodId: "wheat" is not an input of the recipe',
        'npcHouses.kalliste.chains[0].rules.grow_wheat[1].goodId: unknown good "gold"',
        'npcHouses.kalliste.chains[0].rules.grow_wheat[3]: duplicate rule "collect"',
        'npcHouses.kalliste.chains[0].rules.bake_bread: no site of the recipe "bake_bread"',
      ]);
    });

    it('la grammaire fermée : des nombres entiers bornés, au plus vingt règles, aucune autre sorte', () => {
      const sell = (change: object) => ({
        grow_wheat: [{ kind: 'sell', goodId: 'wheat', minPriceOboles: 6, keepUnits: 0, ...change }],
      });
      for (const change of [
        { minPriceOboles: 0 },
        { minPriceOboles: 1.5 },
        { keepUnits: -1 },
        { keepUnits: 1_000_001 },
        { extra: 1 },
      ])
        expect([change, fieldsOf(ruled(sell(change)))[0]]).toEqual([
          change,
          expect.stringMatching(/^npcHouses\.kalliste\.chains\[0\]\.rules\.grow_wheat\[0\]/),
        ]);
      const buy = { kind: 'buy', goodId: 'wheat', maxPriceOboles: 6, targetUnits: 0 };
      expect(fieldsOf(ruled({ mill_flour: [buy] }))).toEqual([
        'npcHouses.kalliste.chains[0].rules.mill_flour[0].targetUnits',
      ]);
      expect(fieldsOf(ruled({ grow_wheat: [{ kind: 'hoard' }] }))).toEqual([
        'npcHouses.kalliste.chains[0].rules.grow_wheat[0].kind',
      ]);
      expect(
        fieldsOf(ruled({ grow_wheat: Array.from({ length: 21 }, () => ({ kind: 'collect' })) })),
      ).toEqual(['npcHouses.kalliste.chains[0].rules.grow_wheat']);
    });

    it('des règles demandent la section des intendants, dont elles suivent le pas', () => {
      const config = structuredClone(INITIAL_CONFIG) as Record<string, unknown>;
      delete config['stewards'];
      const result = validateConfig({ ...config, npcHouses: ruled(RULES) });
      expect(result.ok ? [] : result.errors).toEqual([
        'npcHouses: rules need the stewards section, whose pace they follow',
      ]);
      expect(validateConfig({ ...config, npcHouses: ruled({}) }).ok).toBe(true);
    });
  });

  describe('retrait devant les joueurs (#717)', () => {
    const RETREAT = { highShareBps: 8_000, lowShareBps: 4_000, windowDays: 3, days: 2 };
    const retreatErrors = (npcRetreat: unknown, npcHouses: unknown = houses()) => {
      const result = validateConfig({
        ...(structuredClone(INITIAL_CONFIG) as object),
        npcHouses,
        npcRetreat,
      });
      return result.ok ? [] : result.errors;
    };

    it('absent d’une version publiée avant lui, et admis avec des seuils ordonnés', () => {
      const result = validateConfig({
        ...(structuredClone(INITIAL_CONFIG) as object),
        npcHouses: houses(),
      });
      expect(result.ok && result.config.npcRetreat).toBeUndefined();
      expect(retreatErrors(RETREAT)).toEqual([]);
      expect(retreatErrors({ ...RETREAT, lowShareBps: 0, highShareBps: 10_000 })).toEqual([]);
    });

    it('un seuil bas sous le seuil haut, des points de base, des durées d’au moins une clôture', () => {
      expect(retreatErrors({ ...RETREAT, lowShareBps: 8_000 })).toEqual([
        'npcRetreat.lowShareBps: not below highShareBps',
      ]);
      for (const change of [
        { highShareBps: 10_001 },
        { lowShareBps: -1 },
        { windowDays: 0 },
        { days: 0 },
        { days: 31 },
        { days: 1.5 },
        { extra: 1 },
      ])
        expect([change, retreatErrors({ ...RETREAT, ...change })[0]?.split(':')[0]]).toEqual([
          change,
          expect.stringMatching(/^npcRetreat/),
        ]);
    });

    it('le bien d’une filière sort d’une de ses recettes', () => {
      expect(errorsOf(houses({ goodId: 'wheat' }))).toEqual([]);
      expect(errorsOf(houses({ goodId: 'bread' }))).toEqual([
        'npcHouses.elaia.chains[0].goodId: "bread" is made by no recipe of the chain',
      ]);
      expect(new Set(fieldsOf(houses({ goodId: 'Wheat' })))).toEqual(
        new Set(['npcHouses.elaia.chains[0].goodId']),
      );
    });
  });
});

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
});

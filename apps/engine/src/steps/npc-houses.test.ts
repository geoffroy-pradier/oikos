import type { NpcHouses } from '@oikos/config';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dueNpcHouses, npcChainKey } from './npc-houses';

const SLUGS = ['kalliste', 'elaia', 'halos', 'constructor'];
const CHAINS = ['bread', 'oil', 'wine'];
/** Une configuration de filières sur une partie des cités, et un monde qui en a d'autres, ou les mêmes. */
const arbitraries = fc.record({
  config: fc.dictionary(
    fc.constantFrom(...SLUGS),
    fc.uniqueArray(fc.constantFrom(...CHAINS)).map((ids) => ({
      treasuryCapOboles: 0,
      chains: ids.map((id) => ({
        id,
        name: `Maison ${id}`,
        sites: { grow_wheat: 1 },
        grantOboles: 0,
      })),
    })),
  ) as fc.Arbitrary<NpcHouses>,
  cities: fc
    .uniqueArray(fc.constantFrom(...SLUGS))
    .map((slugs) => slugs.map((slug) => ({ id: `id-${slug}`, slug }))),
  held: fc.uniqueArray(fc.tuple(fc.constantFrom(...SLUGS), fc.constantFrom(...CHAINS))),
});

describe('fondations dues des maisons PNJ de secours (#715)', () => {
  it('chaque filière configurée d’une cité du monde est tenue ou due, une fois ; rejouées, plus rien n’est dû', () => {
    fc.assert(
      fc.property(arbitraries, ({ config, cities, held }) => {
        const tenure = new Set(held.map(([slug, chain]) => npcChainKey(`id-${slug}`, chain)));
        const due = dueNpcHouses(config, cities, tenure);
        const keys = due.map(({ cityId, chain }) => npcChainKey(cityId, chain.id));
        // Aucune fondation en double, aucune pour une filière déjà tenue.
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.filter((key) => tenure.has(key))).toEqual([]);
        // Toute filière configurée d'une cité du monde est tenue ou due ; rien d'autre n'est dû.
        const configured = cities.flatMap((city) =>
          (Object.hasOwn(config, city.slug) ? (config[city.slug]?.chains ?? []) : []).map((chain) =>
            npcChainKey(city.id, chain.id),
          ),
        );
        expect([...keys, ...configured.filter((key) => tenure.has(key))].sort()).toEqual(
          [...configured].sort(),
        );
        // Idempotente : une fois fondées, plus rien n'est dû.
        expect(dueNpcHouses(config, cities, new Set([...tenure, ...keys]))).toEqual([]);
      }),
    );
  });

  it('dans l’ordre des cités, puis des filières ; une cité absente du monde ou de la configuration n’a rien', () => {
    const config: NpcHouses = {
      halos: {
        treasuryCapOboles: 0,
        chains: [
          { id: 'oil', name: 'Pressoirs', sites: { press_oil: 1 }, grantOboles: 0 },
          { id: 'bread', name: 'Greniers', sites: { grow_wheat: 1 }, grantOboles: 0 },
        ],
      },
      thera: {
        treasuryCapOboles: 0,
        chains: [{ id: 'bread', name: 'Fournils', sites: { grow_wheat: 1 }, grantOboles: 0 }],
      },
    };
    const cities = [
      { id: 'c-elaia', slug: 'elaia' },
      { id: 'c-halos', slug: 'halos' },
      // Un identifiant de cité qui nomme une propriété d'objet n'en trouve pas dans la configuration.
      { id: 'c-proto', slug: 'constructor' },
    ];
    expect(
      dueNpcHouses(config, cities, new Set()).map(({ cityId, chain }) => `${cityId}/${chain.id}`),
    ).toEqual(['c-halos/oil', 'c-halos/bread']);
    expect(
      dueNpcHouses(config, cities, new Set([npcChainKey('c-halos', 'oil')])).map(
        (due) => due.chain.id,
      ),
    ).toEqual(['bread']);
  });
});

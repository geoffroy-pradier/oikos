import { cityStartingRecipeId, shipRoute } from '@oikos/config';
import { describe, expect, it } from 'vitest';
import { config, recipeOf } from './city';
import { SCENARIOS } from './world';

/*
 * Scénarios du banc (#712) : chaque cité a ses maisons, que la configuration admet, et reçoit chaque bien du panier
 * de l'indice, de ses maisons ou d'un armateur, par des routes qui existent.
 */
describe.each(Object.values(SCENARIOS))('scénario des $name', (scenario) => {
  it('chaque cité a au moins une maison, née sur son site de départ et qui ne récolte que dans son terroir', () => {
    expect(scenario.config.cities.map((city) => city.id)).toEqual([...scenario.slugs]);
    for (const slug of scenario.slugs) {
      const terroir = config.cities.find((city) => city.id === slug)?.terroir ?? [];
      const roles = scenario.settlements[slug] ?? [];
      expect(roles.length, slug).toBeGreaterThan(0);
      for (const role of roles) {
        expect(role.sites[0], `${slug} ${role.name}`).toBe(cityStartingRecipeId(config, slug));
        expect(role.sites.length, `${slug} ${role.name}`).toBeLessThanOrEqual(4);
        for (const id of role.sites.filter((each) => recipeOf(each).inputs.length === 0))
          expect(terroir, `${slug} ${role.name} ${id}`).toContain(id);
      }
    }
  });

  it('chaque cité reçoit chaque bien du panier, de ses maisons, d’un armateur ou de la maison PNJ qui le tient', () => {
    for (const slug of scenario.slugs) {
      const held = scenario.npcHeld.filter((chain) => chain.slug === slug);
      const goods = new Set([
        ...held.flatMap(
          (chain) =>
            scenario.config.npcHouses[slug]?.chains.find((each) => each.id === chain.chainId)
              ?.goodId ?? [],
        ),
        ...(scenario.settlements[slug] ?? []).flatMap((role) =>
          role.sites.flatMap((id) => recipeOf(id).outputs.map((stack) => stack.goodId)),
        ),
        ...scenario.carriers.flatMap((spec) => [
          ...(spec.home === slug ? spec.toHome : []),
          ...(spec.source === slug ? spec.toSource : []),
        ]),
      ]);
      for (const { goodId } of config.priceIndex.basket)
        expect(goods.has(goodId), `${slug} : ${goodId}`).toBe(true);
    }
  });

  it('un armateur ravitaille chaque cité de chaque bien vital que son terroir ne produit pas (6.1, #714)', () => {
    // Biens vitaux dont la matière première, ou l'intrant, manque au terroir : blé, poisson, sel, bois du charbon.
    const raw = { wheat: 'grow_wheat', fish: 'catch_fish', salt: 'rake_salt', wood: 'fell_wood' };
    const carried = (slug: string) =>
      new Set(
        scenario.carriers.flatMap((spec) => [
          ...(spec.home === slug ? spec.toHome : []),
          ...(spec.source === slug ? spec.toSource : []),
        ]),
      );
    for (const slug of scenario.slugs) {
      const terroir = config.cities.find((city) => city.id === slug)?.terroir ?? [];
      const missing = Object.entries(raw).filter(([, recipeId]) => !terroir.includes(recipeId));
      // Le bois du charbon vient de la cité ou d'un voisin : le banc ne le porte que vers Gamelia (`wood`).
      for (const [goodId] of missing.filter(([goodId]) => goodId !== 'wood'))
        expect(carried(slug).has(goodId), `${slug} : aucun armateur ne lui porte ${goodId}`).toBe(
          true,
        );
    }
  });

  it('un armateur navigue sur une route, ou par une escale quand aucune route ne relie ses deux cités', () => {
    for (const { home, source, via } of scenario.carriers)
      if (via) {
        expect(shipRoute(config, home, source), `${home}–${source}`).toBeUndefined();
        expect(shipRoute(config, home, via), `${home}–${via}`).toBeDefined();
        expect(shipRoute(config, via, source), `${via}–${source}`).toBeDefined();
      } else expect(shipRoute(config, home, source), `${home}–${source}`).toBeDefined();
  });
});

describe('scénario des douze cités', () => {
  it('joue les douze cités de la configuration, chacune au huitième de sa population', () => {
    const { twelve } = SCENARIOS;
    expect([...twelve.slugs].sort()).toEqual(config.cities.map((city) => city.id).sort());
    for (const city of twelve.config.cities)
      expect(city.population['thetes'], city.id).toBe(
        Math.round(
          (config.cities.find((each) => each.id === city.id)?.population['thetes'] ?? 0) / 8,
        ),
      );
  });
});

describe.each(Object.values(SCENARIOS))(
  'maisons PNJ de secours du scénario des $name (#717)',
  (scenario) => {
    it('celles de la configuration, sites divisés comme la population, sans règle de récolte', () => {
      for (const [slug, city] of Object.entries(scenario.config.npcHouses)) {
        expect(scenario.slugs, slug).toContain(slug);
        for (const chain of city.chains) {
          const initial = config.npcHouses[slug]?.chains.find((each) => each.id === chain.id);
          for (const [recipeId, count] of Object.entries(chain.sites))
            expect(count, `${slug}/${chain.id}`).toBe(
              Math.ceil((initial?.sites[recipeId] ?? 0) / 8),
            );
          expect(
            Object.values(chain.rules ?? {})
              .flat()
              .map((rule) => rule.kind),
            `${slug}/${chain.id}`,
          ).not.toContain('collect');
        }
      }
      // Toutes les cités du scénario qui ont des filières de secours dans la configuration les jouent.
      expect(Object.keys(scenario.config.npcHouses).sort()).toEqual(
        Object.keys(config.npcHouses)
          .filter((slug) => scenario.slugs.includes(slug))
          .sort(),
      );
    });

    it('une filière tenue par la maison PNJ ne l’est par aucune maison scriptée de sa cité', () => {
      for (const { slug, chainId } of scenario.npcHeld) {
        const chain = scenario.config.npcHouses[slug]?.chains.find((each) => each.id === chainId);
        expect(chain, `${slug}/${chainId}`).toBeDefined();
        const recipes = new Set(Object.keys(chain?.sites ?? {}));
        for (const role of scenario.settlements[slug] ?? [])
          expect(
            role.sites.filter((id) => recipes.has(id)),
            `${slug} ${role.name}`,
          ).toEqual([]);
      }
    });
  },
);

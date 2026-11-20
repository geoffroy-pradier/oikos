import { cityStartingRecipeId, shipRoute } from '@oikos/config';
import { describe, expect, it } from 'vitest';
import { config, recipeOf } from './city';
import { buysProperties, CARRIERS, SETTLEMENTS, SLUGS, worldConfig } from './world';

/*
 * Scénario du banc des douze cités (#712) : chaque cité a ses maisons, que la configuration admet, et reçoit chaque
 * bien du panier de l'indice, de ses maisons ou d'un armateur, par des routes qui existent.
 */
const produced = (slug: (typeof SLUGS)[number]) =>
  new Set(
    SETTLEMENTS[slug].flatMap((role) =>
      role.sites.flatMap((id) => recipeOf(id).outputs.map((stack) => stack.goodId)),
    ),
  );

describe('scénario des douze cités', () => {
  it('joue les douze cités de la configuration initiale, chacune avec au moins une maison', () => {
    expect([...SLUGS].sort()).toEqual(config.cities.map((city) => city.id).sort());
    expect(worldConfig.cities).toHaveLength(12);
    for (const slug of SLUGS) expect(SETTLEMENTS[slug].length, slug).toBeGreaterThan(0);
  });

  it('chaque maison naît sur le site de départ de sa cité et ne récolte que dans son terroir', () => {
    for (const slug of SLUGS) {
      const terroir = config.cities.find((city) => city.id === slug)?.terroir ?? [];
      for (const role of SETTLEMENTS[slug]) {
        expect(role.sites[0], `${slug} ${role.name}`).toBe(cityStartingRecipeId(config, slug));
        expect(role.sites.length, `${slug} ${role.name}`).toBeLessThanOrEqual(4);
        for (const id of role.sites.filter((each) => recipeOf(each).inputs.length === 0))
          expect(terroir, `${slug} ${role.name} ${id}`).toContain(id);
      }
    }
  });

  it('chaque cité reçoit chaque bien du panier, de ses maisons ou d’un armateur', () => {
    for (const slug of SLUGS) {
      const delivered = new Set(
        CARRIERS.flatMap((spec) => [
          ...(spec.home === slug ? spec.toHome : []),
          ...(spec.source === slug ? spec.toSource : []),
        ]),
      );
      for (const { goodId } of config.priceIndex.basket)
        expect(produced(slug).has(goodId) || delivered.has(goodId), `${slug} : ${goodId}`).toBe(
          true,
        );
    }
  });

  it('un armateur navigue sur une route, ou par une escale quand aucune route ne relie ses deux cités', () => {
    for (const { home, source, via } of CARRIERS)
      if (via) {
        expect(shipRoute(config, home, source), `${home}–${source}`).toBeUndefined();
        expect(shipRoute(config, home, via), `${home}–${via}`).toBeDefined();
        expect(shipRoute(config, via, source), `${via}–${source}`).toBeDefined();
      } else expect(shipRoute(config, home, source), `${home}–${source}`).toBeDefined();
  });

  it('dans les huit cités de #706, seule une maison qui récolte du blé achète un bien à rénover', () => {
    const [vigneron] = SETTLEMENTS.delphis;
    const [pecheur] = SETTLEMENTS.ampelos;
    const [meunier] = SETTLEMENTS.dikaia;
    if (!vigneron || !pecheur || !meunier) throw new Error('No role');
    expect(buysProperties('delphis', vigneron)).toBe(false);
    expect(buysProperties('dikaia', meunier)).toBe(true);
    expect(buysProperties('ampelos', pecheur)).toBe(true);
  });
});

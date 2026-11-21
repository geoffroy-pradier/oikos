import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const oboles = z.number().int().min(0).max(1_000_000_000);

/**
 * Nom d'une maison : la règle de `@oikos/contracts` (`HOUSE_NAME_PATTERN`), que ce paquet n'importe pas, et celle de la
 * base (`houses_name_check`), qui fait foi.
 */
const houseName = z.string().regex(/^\p{L}[\p{L} '-]{1,22}\p{L}$/u);

/** Sites d'une maison PNJ au plus, toutes recettes confondues : plafond technique, pas d'équilibrage. */
export const MAX_NPC_HOUSE_SITES = 50;

/**
 * Filière de secours d'une cité (docs/specs/08-ia.md, 8.3 ; #715) : la maison PNJ qui la tient, ses sites à la fondation
 * et sa dotation. Une seule maison par cité et par filière.
 */
export const npcChainSchema = z.strictObject({
  /** Identifiant de la filière, unique dans sa cité : la base retient la maison PNJ par cité et par filière. */
  id,
  /** Nom de la maison PNJ, public, unique dans le monde sans égard à la casse. */
  name: houseName,
  /** Sites reçus à la fondation, par recette : leur nombre. Au moins un. */
  sites: z.record(id, z.number().int().min(1).max(MAX_NPC_HOUSE_SITES)),
  /** Dotation versée une fois, à la fondation, par le robinet `faucet_npc_house_grant`, en oboles. 0 : aucune. */
  grantOboles: oboles,
});

/** Maisons PNJ de secours d'une cité : ses filières et le plafond de trésorerie de chacune de leurs maisons. */
export const npcCitySchema = z.strictObject({
  /**
   * Trésorerie au plus d'une maison PNJ de la cité, en oboles : la dotation ne le dépasse pas. La stratégie de vente
   * (ticket suivant de #715) s'y règle.
   */
  treasuryCapOboles: oboles,
  chains: z.array(npcChainSchema).max(20),
});

/**
 * Maisons PNJ de secours, par cité de la configuration. Vide dans la configuration initiale : aucune maison PNJ n'est
 * fondée tant qu'une version n'en nomme pas (« P15 »). Jamais lue par les joueurs : seul le moteur la lit.
 */
export const npcHousesSchema = z.record(id, npcCitySchema);
export type NpcHouses = z.infer<typeof npcHousesSchema>;
export type NpcChain = z.infer<typeof npcChainSchema>;

/**
 * Contrôles qui demandent le reste de la configuration : des cités et des recettes connues, chaque recette admise par le
 * terroir de sa cité (`admits`), des filières uniques dans leur cité, au moins un site et au plus
 * `MAX_NPC_HOUSE_SITES` par filière, des noms uniques dans tout le monde (sans égard à la casse, comme la base), une
 * dotation au plus égale au plafond de trésorerie. Rend des chemins sous `npcHouses`.
 */
export function npcHousesIssues(
  npcHouses: NpcHouses,
  known: {
    cities: ReadonlySet<string>;
    recipes: ReadonlySet<string>;
    admits: (cityId: string, recipeId: string) => boolean;
  },
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const names = new Set<string>();
  for (const [cityId, city] of Object.entries(npcHouses)) {
    if (!known.cities.has(cityId))
      issues.push({ path: [cityId], message: `unknown city "${cityId}"` });
    const chains = new Set<string>();
    city.chains.forEach((chain, index) => {
      const path = [cityId, 'chains', index];
      if (chains.has(chain.id))
        issues.push({ path: [...path, 'id'], message: `duplicate id "${chain.id}"` });
      chains.add(chain.id);
      const key = chain.name.toLowerCase();
      if (names.has(key))
        issues.push({ path: [...path, 'name'], message: `duplicate house name "${chain.name}"` });
      names.add(key);
      const counts = Object.entries(chain.sites);
      if (counts.length === 0)
        issues.push({ path: [...path, 'sites'], message: 'at least one site' });
      if (counts.reduce((sum, [, count]) => sum + count, 0) > MAX_NPC_HOUSE_SITES)
        issues.push({ path: [...path, 'sites'], message: `at most ${MAX_NPC_HOUSE_SITES} sites` });
      for (const [recipeId] of counts) {
        if (!known.recipes.has(recipeId))
          issues.push({
            path: [...path, 'sites', recipeId],
            message: `unknown recipe "${recipeId}"`,
          });
        else if (known.cities.has(cityId) && !known.admits(cityId, recipeId))
          issues.push({
            path: [...path, 'sites', recipeId],
            message: `the recipe "${recipeId}" is not in the terroir`,
          });
      }
      if (chain.grantOboles > city.treasuryCapOboles)
        issues.push({ path: [...path, 'grantOboles'], message: 'above the treasury cap' });
    });
  }
  return issues;
}

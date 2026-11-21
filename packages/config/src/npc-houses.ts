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
 * Règles d'un site d'une maison PNJ (#716) : la grammaire fermée des intendants (`stewardRuleSchema` de
 * `@oikos/contracts`, #278), que ce paquet n'importe pas, avec les mêmes bornes (prix et quantité d'un ordre de
 * l'agora, au plus 20 règles, `MAX_STEWARD_RULES`). Le moteur les relit par ce contrat avant de les mener.
 */
const unitPrice = z.number().int().positive().max(1_000_000_000);
const units = z.number().int().nonnegative().max(1_000_000);
export const npcRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('collect') }),
  z.strictObject({
    kind: z.literal('sell'),
    goodId: id,
    minPriceOboles: unitPrice,
    keepUnits: units,
  }),
  z.strictObject({
    kind: z.literal('buy'),
    goodId: id,
    maxPriceOboles: unitPrice,
    targetUnits: units.min(1),
  }),
]);
export type NpcRule = z.infer<typeof npcRuleSchema>;

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
  /**
   * Règles des sites de chaque recette (#716), menées dans l'ordre par le moteur au pas des intendants (#279), sans
   * intendant ni salaire. Une recette sans règles : ses sites ne font rien. Absent d'une version publiée avant elles.
   */
  rules: z.record(id, z.array(npcRuleSchema).max(20)).optional(),
  /**
   * Bien de la filière (#717), sorti d'une de ses recettes : la part des maisons de joueurs dans ses ventes à l'agora
   * de la cité décide du retrait (`npcRetreat`). Absent : la filière ne se retire jamais.
   */
  goodId: id.optional(),
});

/** Maisons PNJ de secours d'une cité : ses filières et le plafond de trésorerie de chacune de leurs maisons. */
export const npcCitySchema = z.strictObject({
  /**
   * Trésorerie au plus d'une maison PNJ de la cité, en oboles : la dotation ne le dépasse pas, et chaque clôture verse
   * ce qui le dépasse au puits `sink_npc_house_surplus`, avant l'entretien (#716).
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

const bps = z.number().int().min(0).max(10_000);
const days = z.number().int().min(1).max(30);
/**
 * Retrait des maisons PNJ devant les joueurs (8.3, #717). À chaque clôture, la part des maisons de joueurs dans les
 * ventes du bien d'une filière (`goodId`), sur les `windowDays` dernières clôtures, se compare à deux seuils, en points
 * de base : au-dessus de `highShareBps` depuis `days` clôtures de suite, la maison PNJ ferme un site ; sous
 * `lowShareBps`, elle en rouvre un, dans la limite de sa filière. L'écart entre les seuils évite les allers-retours.
 */
export const npcRetreatSchema = z.strictObject({
  highShareBps: bps,
  lowShareBps: bps,
  windowDays: days,
  days,
});
export type NpcRetreat = z.infer<typeof npcRetreatSchema>;

/**
 * Contrôles qui demandent le reste de la configuration : des cités et des recettes connues, chaque recette admise par le
 * terroir de sa cité (`admits`), des filières uniques dans leur cité, au moins un site et au plus
 * `MAX_NPC_HOUSE_SITES` par filière, des noms uniques dans tout le monde (sans égard à la casse, comme la base), une
 * dotation au plus égale au plafond de trésorerie. Les règles (#716) visent une recette de la filière, une par sorte et
 * par bien ; une vente, un bien connu, à un prix plancher au plus égal à son prix de référence (`referencePrice`) ; un
 * achat, un intrant de la recette (`inputs`), à un prix au plus égal à sa référence (#717), pour qu'une configuration ne
 * vide pas la dotation vers les joueurs. Le bien de la filière (#717) sort d'une de ses recettes (`outputs`). Rend des
 * chemins sous `npcHouses`.
 */
export function npcHousesIssues(
  npcHouses: NpcHouses,
  known: {
    cities: ReadonlySet<string>;
    recipes: ReadonlySet<string>;
    admits: (cityId: string, recipeId: string) => boolean;
    referencePrice: (goodId: string) => number | undefined;
    inputs: (recipeId: string) => readonly string[];
    outputs: (recipeId: string) => readonly string[];
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
      for (const [recipeId, rules] of Object.entries(chain.rules ?? {})) {
        const at = [...path, 'rules', recipeId];
        if (!Object.hasOwn(chain.sites, recipeId))
          issues.push({ path: at, message: `no site of the recipe "${recipeId}"` });
        const kinds = new Set<string>();
        rules.forEach((rule, position) => {
          const key = rule.kind === 'collect' ? rule.kind : `${rule.kind}:${rule.goodId}`;
          if (kinds.has(key))
            issues.push({ path: [...at, position], message: `duplicate rule "${key}"` });
          kinds.add(key);
          if (rule.kind === 'collect') return;
          const reference = known.referencePrice(rule.goodId);
          if (reference === undefined)
            issues.push({
              path: [...at, position, 'goodId'],
              message: `unknown good "${rule.goodId}"`,
            });
          else if (rule.kind === 'sell' && rule.minPriceOboles > reference)
            issues.push({
              path: [...at, position, 'minPriceOboles'],
              message: `above the reference price (${reference})`,
            });
          else if (rule.kind === 'buy' && rule.maxPriceOboles > reference)
            issues.push({
              path: [...at, position, 'maxPriceOboles'],
              message: `above the reference price (${reference})`,
            });
          if (rule.kind === 'buy' && !known.inputs(recipeId).includes(rule.goodId))
            issues.push({
              path: [...at, position, 'goodId'],
              message: `"${rule.goodId}" is not an input of the recipe`,
            });
        });
      }
      if (
        chain.goodId !== undefined &&
        !counts.some(([recipeId]) => known.outputs(recipeId).includes(chain.goodId ?? ''))
      )
        issues.push({
          path: [...path, 'goodId'],
          message: `"${chain.goodId}" is made by no recipe of the chain`,
        });
      if (chain.grantOboles > city.treasuryCapOboles)
        issues.push({ path: [...path, 'grantOboles'], message: 'above the treasury cap' });
    });
  }
  return issues;
}

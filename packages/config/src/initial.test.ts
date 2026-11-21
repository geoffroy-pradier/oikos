import { describe, expect, it } from 'vitest';
import {
  cityStartingRecipeId,
  cityTerroirAdmits,
  DEFAULT_LABOR,
  DEFAULT_NPC_PUBLIC_INCOME_BPS,
  INITIAL_CONFIG,
  routeLossRiskBps,
  routeStormLossRiskBps,
  validateConfig,
} from './index';

/** Les quatre cités de #250, puis les huit de #706, dans l'ordre de la configuration. */
const FOUR_CITIES = ['kalliste', 'elaia', 'ampelos', 'halos'];
const EIGHT_CITIES = [
  'dikaia',
  'gamelia',
  'delphis',
  'agrotera',
  'phrourion',
  'myrrhine',
  'chalkeia',
  'emporion',
];
/** Les dix matières premières de #708 et leurs recettes, dans l'ordre de la configuration. */
const TEN_RAW: Record<string, string> = {
  barley: 'grow_barley',
  flax: 'grow_flax',
  figs: 'grow_figs',
  hides: 'skin_hides',
  honey: 'gather_honey',
  marble: 'quarry_marble',
  copper: 'mine_copper',
  tin: 'mine_tin',
  iron: 'mine_iron',
  silver: 'mine_silver',
};
const [TEN_RAW_GOODS, TEN_RAW_RECIPES] = [Object.keys(TEN_RAW), Object.values(TEN_RAW)];
/** Les douze intermédiaires de #709 et leurs ateliers, dans l'ordre de la configuration. */
const TWELVE_INTERMEDIATE: Record<string, string> = {
  barley_flour: 'mill_barley',
  must: 'press_must',
  planks: 'saw_planks',
  bronze: 'smelt_bronze',
  wrought_iron: 'forge_iron',
  thread: 'spin_thread',
  leather: 'tan_leather',
  linen_cloth: 'weave_linen',
  pigments: 'grind_pigments',
  wax: 'render_wax',
  silver_ingots: 'cast_silver',
  marble_blocks: 'cut_marble',
};
const [TWELVE_GOODS, TWELVE_RECIPES] = [
  Object.keys(TWELVE_INTERMEDIATE),
  Object.values(TWELVE_INTERMEDIATE),
];
/** Les sept biens finis du quotidien de #710 et leurs ateliers, dans l'ordre de la configuration. */
const SEVEN_FINISHED: Record<string, string> = {
  barley_cakes: 'bake_cakes',
  salted_fish: 'salt_fish',
  garum: 'brew_garum',
  oil_lamps: 'mould_lamps',
  sandals: 'make_sandals',
  tools: 'forge_tools',
  clothes: 'sew_clothes',
};
const [SEVEN_GOODS, SEVEN_RECIPES] = [Object.keys(SEVEN_FINISHED), Object.values(SEVEN_FINISHED)];
/** Les dix biens finis de luxe et d'ouvrage de #711 et leurs ateliers, dans l'ordre de la configuration. */
const TEN_FINISHED: Record<string, string> = {
  painted_ceramics: 'paint_ceramics',
  perfumes: 'blend_perfumes',
  jewelry: 'craft_jewelry',
  furniture: 'build_furniture',
  statues: 'carve_statues',
  weapons: 'forge_weapons',
  sails: 'sew_sails',
  candles: 'dip_candles',
  mosaics: 'lay_mosaics',
  fig_cakes: 'press_fig_cakes',
};
const [TEN_GOODS, TEN_RECIPES] = [Object.keys(TEN_FINISHED), Object.values(TEN_FINISHED)];
/**
 * Panier de chaque classe avant #713, écrit à la main : les biens de la phase 2, que #713 ne change pas (5.2).
 * Les thètes le gardent seul ; les trois classes aisées y ajoutent les biens finis de #710 et #711.
 */
const PHASE_2_BASKETS: Record<string, [string, string, number][]> = {
  thetes: [
    ['wheat', 'vital', 4.2],
    ['bread', 'vital', 1.333],
    ['fish', 'vital', 0.4],
    ['salt', 'vital', 0.133],
    ['olive_oil', 'comfort', 0.1],
    ['wine', 'comfort', 0.067],
  ],
  zeugitai: [
    ['wheat', 'vital', 2.1],
    ['bread', 'vital', 1.533],
    ['fish', 'vital', 0.533],
    ['salt', 'vital', 0.167],
    ['olive_oil', 'comfort', 0.2],
    ['wine', 'comfort', 0.2],
    ['cloth', 'comfort', 0.04],
  ],
  hippeis: [
    ['bread', 'vital', 1.733],
    ['fish', 'vital', 0.667],
    ['salt', 'vital', 0.2],
    ['olive_oil', 'comfort', 0.333],
    ['wine', 'comfort', 0.4],
    ['cloth', 'comfort', 0.1],
    ['amphorae', 'luxury', 0.053],
  ],
  pentakosiomedimnoi: [
    ['bread', 'vital', 1.6],
    ['fish', 'vital', 0.8],
    ['salt', 'vital', 0.2],
    ['olive_oil', 'comfort', 0.533],
    ['wine', 'luxury', 0.8],
    ['cloth', 'luxury', 0.267],
    ['amphorae', 'luxury', 0.2],
  ],
};
/** Revenu par tick pour 1 000 habitants de chaque classe avant #713 : son revenu public d'un jour reste le même. */
const PHASE_2_INCOME: Record<string, number> = {
  thetes: 70,
  zeugitai: 73,
  hippeis: 82,
  pentakosiomedimnoi: 120,
};

describe('jeu de valeurs initial', () => {
  const result = validateConfig(INITIAL_CONFIG);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  const { config } = result;

  it('contient 54 biens, dont 18 matières premières, 16 intermédiaires et 20 finis, des recettes, les quatre classes de PNJ d’une cité et douze cités (#706, #708, #709, #710, #711)', () => {
    expect(config.goods).toHaveLength(54);
    expect(config.goods.filter((good) => good.tier === 'raw')).toHaveLength(18);
    expect(config.goods.filter((good) => good.tier === 'intermediate')).toHaveLength(16);
    expect(config.goods.filter((good) => good.tier === 'finished')).toHaveLength(20);
    expect(config.recipes).toHaveLength(54);
    expect(config.npcClasses.map((npcClass) => npcClass.id)).toEqual([
      'thetes',
      'zeugitai',
      'hippeis',
      'pentakosiomedimnoi',
    ]);
    expect(config.cities.map((city) => city.id)).toEqual([...FOUR_CITIES, ...EIGHT_CITIES]);
  });

  it('douze dieux, dont un protecteur distinct pour chacune des douze cités, toutes à port (#250, #706)', () => {
    expect(config.gods.map((god) => god.id)).toEqual([
      'demeter',
      'athena',
      'dionysos',
      'poseidon',
      'apollo',
      'zeus',
      'hera',
      'artemis',
      'ares',
      'aphrodite',
      'hephaistos',
      'hermes',
    ]);
    expect(config.cities.map((city) => [city.id, city.patronGodId, city.hasPort])).toEqual([
      ['kalliste', 'demeter', true],
      ['elaia', 'athena', true],
      ['ampelos', 'dionysos', true],
      ['halos', 'poseidon', true],
      ['dikaia', 'zeus', true],
      ['gamelia', 'hera', true],
      ['delphis', 'apollo', true],
      ['agrotera', 'artemis', true],
      ['phrourion', 'ares', true],
      ['myrrhine', 'aphrodite', true],
      ['chalkeia', 'hephaistos', true],
      ['emporion', 'hermes', true],
    ]);
  });

  it('Charis (#265, #713) : chaque dieu prend la monnaie et les biens de son domaine à leur prix de référence', () => {
    const price = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
    const domains = Object.fromEntries(
      config.gods.map((god) => [god.id, Object.keys(god.charisPerUnit).sort()]),
    );
    // Domaines de la phase 2, puis les biens de #708 à #711 que #713 y ajoute (2, 7.1) : chacun des douze dieux en a.
    expect(domains).toEqual({
      demeter: ['barley', 'barley_cakes', 'barley_flour', 'bread', 'flour', 'wheat'],
      athena: ['cloth', 'oil_lamps', 'olive_oil', 'olives', 'painted_ceramics', 'tools'],
      dionysos: ['fig_cakes', 'figs', 'grapes', 'must', 'wine'],
      poseidon: ['fish', 'garum', 'sails', 'salt', 'salted_fish'],
      apollo: ['candles', 'mosaics'],
      zeus: ['marble', 'marble_blocks', 'statues'],
      hera: ['clothes', 'furniture'],
      artemis: ['hides', 'honey', 'wood'],
      ares: ['bronze', 'weapons'],
      aphrodite: ['cloth', 'jewelry', 'olive_oil', 'perfumes'],
      hephaistos: ['amphorae', 'charcoal', 'clay', 'copper', 'iron', 'tin', 'wrought_iron'],
      hermes: ['sandals', 'silver', 'silver_ingots'],
    });
    for (const god of config.gods) {
      // Offrir un bien rapporte autant qu'offrir son prix de référence en oboles.
      expect(god.charisPerObole).toBe(1);
      for (const [goodId, rate] of Object.entries(god.charisPerUnit))
        expect(rate).toBe(price.get(goodId));
      // Calibrage (#668) : un déclin lent, de 1 % par jour, et la même Charis de cité pour chaque protecteur.
      expect([god.dailyDecayBps, god.cityCharisWeightBps]).toEqual([100, 10_000]);
    }
  });

  it('terroirs et recettes de départ des douze cités (#250, #706, #708)', () => {
    // Productions de la phase 2 ; celles de #708 ont leur propre test.
    const terroir = (cityId: string) =>
      [...(config.cities.find((city) => city.id === cityId)?.terroir ?? [])]
        .filter((recipeId) => !TEN_RAW_RECIPES.includes(recipeId))
        .sort();
    // Kallistè (#669, #714) : les matières premières de la phase 1 sauf la laine, qu'Ampelos et Halos produisent, et
    // le sel, qu'Elaia et Halos raffinent.
    expect(terroir('kalliste')).toEqual([
      'catch_fish',
      'dig_clay',
      'fell_wood',
      'grow_grapes',
      'grow_olives',
      'grow_wheat',
    ]);
    expect(terroir('elaia')).toEqual(['fell_wood', 'grow_olives', 'grow_wheat', 'rake_salt']);
    expect(terroir('ampelos')).toEqual(['catch_fish', 'dig_clay', 'grow_grapes', 'shear_wool']);
    expect(terroir('halos')).toEqual([
      'catch_fish',
      'dig_clay',
      'fell_wood',
      'rake_salt',
      'shear_wool',
    ]);
    expect(terroir('dikaia')).toEqual(['dig_clay', 'fell_wood', 'grow_olives', 'grow_wheat']);
    expect(terroir('gamelia')).toEqual(['grow_grapes', 'grow_olives', 'grow_wheat', 'shear_wool']);
    expect(terroir('delphis')).toEqual(['dig_clay', 'grow_grapes', 'grow_olives', 'shear_wool']);
    expect(terroir('agrotera')).toEqual(['fell_wood', 'grow_olives', 'grow_wheat', 'shear_wool']);
    expect(terroir('phrourion')).toEqual(['dig_clay', 'fell_wood', 'grow_wheat', 'shear_wool']);
    expect(terroir('myrrhine')).toEqual(['catch_fish', 'grow_grapes', 'grow_olives', 'shear_wool']);
    expect(terroir('chalkeia')).toEqual(['dig_clay', 'fell_wood', 'grow_olives', 'rake_salt']);
    expect(terroir('emporion')).toEqual(['catch_fish', 'grow_olives', 'rake_salt', 'shear_wool']);
    expect(config.cities.map((city) => cityStartingRecipeId(config, city.id))).toEqual([
      'grow_wheat',
      'grow_wheat',
      'grow_grapes',
      'catch_fish',
      'grow_wheat',
      'grow_wheat',
      'grow_olives',
      'fell_wood',
      'grow_wheat',
      'grow_grapes',
      'fell_wood',
      'catch_fish',
    ]);
  });

  it('dix matières premières de plus (#708), chacune de sa recette sans intrant, au terroir d’une à quatre cités', () => {
    expect(config.goods.slice(15, 25).map((good) => [good.id, good.tier])).toEqual(
      TEN_RAW_GOODS.map((id) => [id, 'raw']),
    );
    expect(
      config.recipes
        .slice(15, 25)
        .map(({ id, inputs, outputs }) => [id, inputs, outputs[0]?.goodId]),
    ).toEqual(TEN_RAW_RECIPES.map((id, i) => [id, [], TEN_RAW_GOODS[i]]));
    for (const recipeId of TEN_RAW_RECIPES) {
      const cities = config.cities.filter((city) => city.terroir?.includes(recipeId));
      expect(cities.length, recipeId).toBeGreaterThanOrEqual(1);
      expect(cities.length, recipeId).toBeLessThanOrEqual(4);
      // Les bancs jouent les quatre premières cités avec les productions de la phase 2 (5.5).
      expect(
        cities.filter((city) => FOUR_CITIES.includes(city.id)),
        recipeId,
      ).toEqual([]);
    }
  });

  it('marge nette quotidienne de chaque recette de #708, au prix de référence, entre la moitié et le double de la médiane de la phase 2', () => {
    const price = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
    const { coefficientBps, dailyOboles } = config.sites.upkeep;
    // Ventes d'un jour au prix de référence, moins l'entretien du site et le salaire de ses travailleurs.
    const margin = (recipe: (typeof config.recipes)[number]) =>
      recipe.outputs.reduce((sum, out) => sum + out.quantity * (price.get(out.goodId) ?? NaN), 0) *
        (1440 / recipe.durationMinutes) -
      Math.ceil((dailyOboles[recipe.siteType] * coefficientBps) / 10_000) -
      recipe.workers * (config.staff.dailyWageOboles['kalliste'] ?? NaN);
    const phase2 = config.recipes
      .filter((recipe) => recipe.inputs.length === 0 && !TEN_RAW_RECIPES.includes(recipe.id))
      .map(margin)
      .sort((a, b) => a - b);
    // Huit matières premières de la phase 2 : médiane entre la quatrième et la cinquième, bornée à la main.
    expect(phase2).toHaveLength(8);
    expect(((phase2[3] ?? NaN) + (phase2[4] ?? NaN)) / 2).toBe(899);
    for (const recipe of config.recipes.filter((each) => TEN_RAW_RECIPES.includes(each.id))) {
      expect(margin(recipe), recipe.id).toBeGreaterThanOrEqual(899 / 2);
      expect(margin(recipe), recipe.id).toBeLessThanOrEqual(899 * 2);
    }
  });

  it('douze intermédiaires de plus (#709), chacun d’un atelier à intrants, seize en tout', () => {
    expect(config.goods.slice(25, 37).map((good) => [good.id, good.tier])).toEqual(
      TWELVE_GOODS.map((id) => [id, 'intermediate']),
    );
    const workshops = config.recipes.slice(25, 37);
    expect(workshops.map((recipe) => [recipe.id, recipe.siteType, recipe.outputs.length])).toEqual(
      TWELVE_RECIPES.map((id) => [id, 'workshop', 1]),
    );
    expect(workshops.map((recipe) => recipe.outputs[0]?.goodId)).toEqual(TWELVE_GOODS);
    for (const recipe of workshops) expect(recipe.inputs.length, recipe.id).toBeGreaterThan(0);
    // Chaque atelier ne consomme que des matières premières, ou le fil qu'une autre recette de #709 produit.
    const tier = new Map(config.goods.map((good) => [good.id, good.tier]));
    for (const recipe of workshops)
      for (const input of recipe.inputs)
        expect(
          tier.get(input.goodId) === 'raw' || ['charcoal', 'thread'].includes(input.goodId),
          `${recipe.id} consomme ${input.goodId}`,
        ).toBe(true);
    // Les recettes de la phase 2 ne changent pas (décision de #709) : le vin reste fait de raisin, le tissu de laine.
    const recipe = (id: string) => config.recipes.find((each) => each.id === id);
    expect(recipe('ferment_wine')?.inputs.map((input) => input.goodId)).toEqual([
      'grapes',
      'amphorae',
    ]);
    expect(recipe('weave_cloth')?.inputs.map((input) => input.goodId)).toEqual(['wool']);
  });

  it('marge nette quotidienne de chaque atelier de #709, au prix de référence, entre la moitié et le double de la médiane de la phase 2', () => {
    const price = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
    const { coefficientBps, dailyOboles } = config.sites.upkeep;
    const value = (lines: { goodId: string; quantity: number }[]) =>
      lines.reduce((sum, line) => sum + line.quantity * (price.get(line.goodId) ?? NaN), 0);
    // Un jour de cycles : extrants moins intrants au prix de référence, moins l'entretien et les salaires.
    const margin = (recipe: (typeof config.recipes)[number]) =>
      (value(recipe.outputs) - value(recipe.inputs)) * (1440 / recipe.durationMinutes) -
      Math.ceil((dailyOboles[recipe.siteType] * coefficientBps) / 10_000) -
      recipe.workers * (config.staff.dailyWageOboles['kalliste'] ?? NaN);
    // Médiane des huit matières premières de la phase 2 (899 oboles), écrite à la main : bornes de 449,5 à 1 798.
    for (const recipe of config.recipes.filter((each) => TWELVE_RECIPES.includes(each.id))) {
      expect(margin(recipe), recipe.id).toBeGreaterThanOrEqual(899 / 2);
      expect(margin(recipe), recipe.id).toBeLessThanOrEqual(899 * 2);
    }
  });

  it('chaque matière première et chaque intermédiaire est l’intrant d’au moins une recette (#711)', () => {
    const consumed = new Set(config.recipes.flatMap((r) => r.inputs.map((i) => i.goodId)));
    const upstream = config.goods.filter((good) => good.tier !== 'finished');
    expect(upstream).toHaveLength(34);
    // Aucune liste d'attente : un bien sans débouché est nommé ici.
    expect(upstream.filter((good) => !consumed.has(good.id)).map((good) => good.id)).toEqual([]);
  });

  it('sept biens finis de plus (#710), chacun d’un atelier, dont les intrants sont des intermédiaires ou des matières premières', () => {
    expect(config.goods.slice(37, 44).map((good) => [good.id, good.tier])).toEqual(
      SEVEN_GOODS.map((id) => [id, 'finished']),
    );
    const workshops = config.recipes.slice(37, 44);
    expect(workshops.map((recipe) => [recipe.id, recipe.siteType, recipe.outputs.length])).toEqual(
      SEVEN_RECIPES.map((id) => [id, 'workshop', 1]),
    );
    expect(workshops.map((recipe) => recipe.outputs[0]?.goodId)).toEqual(SEVEN_GOODS);
    const tier = new Map(config.goods.map((good) => [good.id, good.tier]));
    for (const recipe of workshops) {
      expect(recipe.inputs.length, recipe.id).toBeGreaterThan(0);
      // Aucun bien fini ne sert d'intrant, sauf les amphores (le contenant du garum) : pas de chaîne de biens finis.
      for (const input of recipe.inputs)
        expect(
          input.goodId === 'amphorae' || tier.get(input.goodId) !== 'finished',
          `${recipe.id} consomme ${input.goodId}`,
        ).toBe(true);
    }
    // Les biens finis de la phase 2 (pain, vin, amphores) et leurs recettes ne changent pas.
    expect(config.goods.slice(12, 15).map((good) => good.id)).toEqual([
      'bread',
      'wine',
      'amphorae',
    ]);
  });

  it('marge nette quotidienne de chaque atelier de #710, au prix de référence, entre la moitié et le double de la médiane de la phase 2', () => {
    const price = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
    const { coefficientBps, dailyOboles } = config.sites.upkeep;
    const value = (lines: { goodId: string; quantity: number }[]) =>
      lines.reduce((sum, line) => sum + line.quantity * (price.get(line.goodId) ?? NaN), 0);
    const margin = (recipe: (typeof config.recipes)[number]) =>
      (value(recipe.outputs) - value(recipe.inputs)) * (1440 / recipe.durationMinutes) -
      Math.ceil((dailyOboles[recipe.siteType] * coefficientBps) / 10_000) -
      recipe.workers * (config.staff.dailyWageOboles['kalliste'] ?? NaN);
    // Médiane des huit matières premières de la phase 2 (899 oboles), écrite à la main : bornes de 449,5 à 1 798.
    for (const recipe of config.recipes.filter((each) => SEVEN_RECIPES.includes(each.id))) {
      expect(margin(recipe), recipe.id).toBeGreaterThanOrEqual(899 / 2);
      expect(margin(recipe), recipe.id).toBeLessThanOrEqual(899 * 2);
    }
  });

  it('dix biens finis de plus (#711), chacun d’un atelier, dont les intrants ne sont jamais des biens finis', () => {
    expect(config.goods.slice(44).map((good) => [good.id, good.tier])).toEqual(
      TEN_GOODS.map((id) => [id, 'finished']),
    );
    const workshops = config.recipes.slice(44);
    expect(workshops.map((recipe) => [recipe.id, recipe.siteType, recipe.outputs.length])).toEqual(
      TEN_RECIPES.map((id) => [id, 'workshop', 1]),
    );
    expect(workshops.map((recipe) => recipe.outputs[0]?.goodId)).toEqual(TEN_GOODS);
    const tier = new Map(config.goods.map((good) => [good.id, good.tier]));
    for (const recipe of workshops) {
      expect(recipe.inputs.length, recipe.id).toBeGreaterThan(0);
      // Pas de chaîne de biens finis : seule l'amphore du garum (#710) en sert d'intrant.
      for (const input of recipe.inputs)
        expect(tier.get(input.goodId), `${recipe.id} consomme ${input.goodId}`).not.toBe(
          'finished',
        );
      // Au moins trois unités par cycle : l'atelier inspiré en ajoute une (7.1, décision de #710).
      expect(recipe.outputs[0]?.quantity, recipe.id).toBeGreaterThanOrEqual(3);
    }
    // Les navires restent achetés à la cité (4.6) : aucun bien « navire » au catalogue.
    expect(config.goods.filter((good) => /ship|navire/.test(good.id))).toEqual([]);
  });

  it('marge nette quotidienne de chaque atelier de #711, au prix de référence, entre la moitié et le double de la médiane de la phase 2', () => {
    const price = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
    const { coefficientBps, dailyOboles } = config.sites.upkeep;
    const value = (lines: { goodId: string; quantity: number }[]) =>
      lines.reduce((sum, line) => sum + line.quantity * (price.get(line.goodId) ?? NaN), 0);
    const margin = (recipe: (typeof config.recipes)[number]) =>
      (value(recipe.outputs) - value(recipe.inputs)) * (1440 / recipe.durationMinutes) -
      Math.ceil((dailyOboles[recipe.siteType] * coefficientBps) / 10_000) -
      recipe.workers * (config.staff.dailyWageOboles['kalliste'] ?? NaN);
    // Médiane des huit matières premières de la phase 2 (899 oboles), écrite à la main : bornes de 449,5 à 1 798.
    for (const recipe of config.recipes.filter((each) => TEN_RECIPES.includes(each.id))) {
      expect(margin(recipe), recipe.id).toBeGreaterThanOrEqual(899 / 2);
      expect(margin(recipe), recipe.id).toBeLessThanOrEqual(899 * 2);
    }
  });

  it('aucune des douze cités ne produit tous les biens vitaux du panier de ses PNJ : blé, poisson, sel et bois du charbon du pain (6.1, #706, #714)', () => {
    const vital = new Set(
      config.npcClasses.flatMap((npcClass) =>
        npcClass.basket.filter((entry) => entry.need === 'vital').map((entry) => entry.goodId),
      ),
    );
    expect([...vital].sort()).toEqual(['bread', 'fish', 'salt', 'wheat']);
    // Matières premières d'un bien vital : celles de ses intrants, de proche en proche, charbon compris.
    const rawOf = (goodId: string, seen = new Set<string>()): string[] => {
      if (seen.has(goodId)) return [];
      seen.add(goodId);
      return config.recipes
        .filter((recipe) => recipe.outputs.some((output) => output.goodId === goodId))
        .flatMap((recipe) =>
          recipe.inputs.length === 0
            ? [goodId]
            : recipe.inputs.flatMap((input) => rawOf(input.goodId, seen)),
        );
    };
    const needed = new Set([...vital].flatMap((goodId) => rawOf(goodId)));
    expect([...needed].sort()).toEqual(['fish', 'salt', 'wheat', 'wood']);
    expect(config.cities).toHaveLength(12);
    for (const city of config.cities) {
      const grown = new Set(
        config.recipes
          .filter((recipe) => recipe.inputs.length === 0 && cityTerroirAdmits(city, recipe))
          .flatMap((recipe) => recipe.outputs.map((output) => output.goodId)),
      );
      const missing = [...needed].filter((goodId) => !grown.has(goodId));
      expect(missing.length, `${city.id} produit tous ses biens vitaux`).toBeGreaterThan(0);
      // Kallistè (#714) perd au moins le poisson ou le sel, pas seulement la laine.
      if (city.id === 'kalliste')
        expect(
          missing.some((goodId) => goodId === 'fish' || goodId === 'salt'),
          'kalliste garde son poisson et son sel',
        ).toBe(true);
    }
  });

  it('chaque cité a la population de la cité prototype, classe par classe (5.5)', () => {
    const [kalliste, ...others] = config.cities;
    for (const city of others) expect(city.population).toEqual(kalliste?.population);
  });

  it('chaque bien est produit par au moins une recette', () => {
    const produced = new Set(config.recipes.flatMap((r) => r.outputs.map((o) => o.goodId)));
    expect(config.goods.filter((good) => !produced.has(good.id))).toEqual([]);
  });

  it('chaque bien du catalogue a un usage : intrant, panier, offrande, fête ou rénovation (#713)', () => {
    const used = new Set([
      ...config.recipes.flatMap((r) => r.inputs.map((i) => i.goodId)),
      ...config.npcClasses.flatMap((c) => c.basket.map((entry) => entry.goodId)),
      ...config.gods.flatMap((god) => Object.keys(god.charisPerUnit)),
      ...(config.decrees?.models.festival?.goodIds ?? []),
      ...config.properties.sizes.flatMap((size) => size.renovation.goods.map((g) => g.goodId)),
    ]);
    // Aucune liste d'attente : un bien sans usage est nommé ici.
    expect(config.goods.filter((good) => !used.has(good.id)).map((good) => good.id)).toEqual([]);
  });

  it('paniers (#713) : les classes aisées ajoutent les biens finis nouveaux en confort et en luxe, le reste inchangé', () => {
    const added = new Set<string>();
    for (const npcClass of config.npcClasses) {
      const before = PHASE_2_BASKETS[npcClass.id] ?? [];
      const entries = npcClass.basket.map((e) => [e.goodId, e.need, e.quantityPerThousand]);
      // Le panier de la phase 2 en tête, inchangé : besoins vitaux, confort et luxe d'avant.
      expect(entries.slice(0, before.length), npcClass.id).toEqual(before);
      const after = npcClass.basket.slice(before.length);
      // Les thètes, qui achètent le prix (4.3), n'ajoutent rien ; chaque classe aisée ajoute des biens finis nouveaux.
      expect(after.length > 0, npcClass.id).toBe(npcClass.id !== 'thetes');
      for (const { goodId, need } of after) {
        expect([...SEVEN_GOODS, ...TEN_GOODS], npcClass.id).toContain(goodId);
        // Aucun besoin vital nouveau : la couverture des besoins vitaux (5.2) ne change pas.
        expect(['comfort', 'luxury'], `${npcClass.id} ${goodId}`).toContain(need);
        added.add(goodId);
      }
    }
    expect([...added].sort()).toEqual([...SEVEN_GOODS, ...TEN_GOODS].sort());
  });

  it('chaque bien fini nouveau a, dans les douze cités, la demande d’au moins un atelier au prix de référence (#713)', () => {
    const ticksPerDay = 1440 / config.clock.tickMinutes;
    for (const recipe of config.recipes.filter((each) =>
      [...SEVEN_RECIPES, ...TEN_RECIPES].includes(each.id),
    )) {
      const output = recipe.outputs[0];
      if (!output) throw new Error(recipe.id);
      // Demande d'un jour des PNJ des douze cités, à leur population initiale.
      const demand = config.cities.reduce(
        (sum, city) =>
          sum +
          config.npcClasses.reduce((each, npcClass) => {
            const entry = npcClass.basket.find((e) => e.goodId === output.goodId);
            const population = city.population[npcClass.id] ?? 0;
            return each + ((entry?.quantityPerThousand ?? 0) * population * ticksPerDay) / 1000;
          }, 0),
        0,
      );
      // Extrant d'un jour d'un atelier : au moins un atelier du monde trouve preneur pour toute sa production.
      expect(demand, output.goodId).toBeGreaterThanOrEqual(
        (output.quantity * 1440) / recipe.durationMinutes,
      );
    }
  });

  it('fêtes (#713) : les biens de la phase 2, puis des biens finis nouveaux, chacun acheté par les PNJ', () => {
    const festival = config.decrees?.models.festival;
    expect(festival?.goodIds).toEqual([
      'bread',
      'wine',
      'olive_oil',
      'fish',
      'barley_cakes',
      'salted_fish',
      'garum',
      'fig_cakes',
      'oil_lamps',
      'candles',
      'perfumes',
      'clothes',
    ]);
    // Une fête relève la demande des PNJ (5.2) : un bien qu'aucune classe n'achète n'y aurait aucun effet.
    const wanted = new Set(config.npcClasses.flatMap((c) => c.basket.map((entry) => entry.goodId)));
    expect(festival?.goodIds.filter((goodId) => !wanted.has(goodId))).toEqual([]);
    // Au plus trois biens par fête : les bancs, qui en prennent les trois premiers, gardent leurs fêtes.
    expect(festival?.maxGoods).toBe(3);
  });

  it('le revenu de chaque classe couvre son panier au prix de référence, sans le dépasser de beaucoup', () => {
    const price = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
    for (const npcClass of config.npcClasses) {
      const reference = npcClass.basket.reduce(
        (sum, entry) => sum + entry.quantityPerThousand * (price.get(entry.goodId) ?? 0),
        0,
      );
      // Assez pour acheter tout le panier au prix de référence ; pas assez pour financer une flambée des prix.
      expect(npcClass.incomePerThousand).toBeGreaterThanOrEqual(reference);
      expect(npcClass.incomePerThousand).toBeLessThanOrEqual(reference * 1.5);
      // Le revenu d'une classe aisée suit son panier (#713) : 125 % de sa dépense de référence, à l'obole supérieure.
      if (npcClass.id !== 'thetes')
        expect(npcClass.incomePerThousand, npcClass.id).toBe(Math.ceil(reference * 1.25));
    }
  });

  /** Salaire d'un jour d'un travailleur, le même dans chaque cité (#668). */
  const wage = config.staff.dailyWageOboles['kalliste'] ?? NaN;

  it('un salaire d’une drachme par jour, le même dans chaque cité (#668)', () => {
    expect(Object.keys(config.staff.dailyWageOboles).sort()).toEqual(
      config.cities.map((city) => city.id).sort(),
    );
    // Le salaire d'un ouvrier des chantiers de l'Érechthéion (409 av. J.-C.) : une drachme, six oboles.
    expect(wage).toBe(6);
    for (const daily of Object.values(config.staff.dailyWageOboles)) expect(daily).toBe(wage);
    // Un site paie ses travailleurs moins que son entretien : la relance d'un site reste dominée par l'entretien.
    const { dailyOboles } = config.sites.upkeep;
    for (const recipe of config.recipes)
      expect(recipe.workers * wage).toBeLessThan(dailyOboles[recipe.siteType]);
  });

  it('le revenu public d’un jour de chaque classe reste celui d’avant ses paniers nouveaux (#632, #283, #713)', () => {
    // Revenu d'un jour entier pour les thètes, comme l'ancien robinet ; pour les classes aisées, dont le revenu suit le
    // panier, la part qui rend le revenu public d'avant #713 (arrondie au point inférieur) : la masse ne croît pas plus vite.
    for (const npcClass of config.npcClasses) {
      const before = PHASE_2_INCOME[npcClass.id] ?? NaN;
      expect(npcClass.publicIncomeBps, npcClass.id).toBe(
        Math.floor((before * 10_000) / npcClass.incomePerThousand),
      );
    }
    expect(config.npcClasses.find((each) => each.id === 'thetes')?.publicIncomeBps).toBe(10_000);
    // Une version publiée avant le paramètre garde le même comportement.
    expect(DEFAULT_NPC_PUBLIC_INCOME_BPS).toBe(10_000);
    // Et la même dans chaque cité, en attendant que #283 vise les importatrices (#657).
    for (const city of config.cities) expect(city.npcPublicIncomeBps).toBe(10_000);
  });

  it('le budget non dépensé des PNJ se reporte, au plus deux unités au prix de réserve (#675)', () => {
    expect(config.market.npcBudgetCarryUnits).toBe(2);
  });

  it('marché du travail : une offre bornée par la population, un hébergement qui monte avec la pénurie (#668)', () => {
    const { workingShareBps, wage: curve, lodging } = config.labor;
    // Thètes et zeugites travaillent : à sa population de départ comme à sa plus basse (`minShareBps`), chaque cité
    // offre de quoi faire tourner trente maisons de quatre sites, chacun de quatre travailleurs (5.5).
    const smallest = config.populationDynamics.minShareBps / 10_000;
    expect(Object.keys(workingShareBps).sort()).toEqual(['thetes', 'zeugitai']);
    for (const city of config.cities) {
      const supply = Object.entries(workingShareBps).reduce(
        (sum, [classId, share]) =>
          sum + Math.floor(((city.population[classId] ?? 0) * smallest * share) / 10_000),
        0,
      );
      expect(supply).toBeGreaterThanOrEqual(30 * 4 * 4);
    }
    // Le salaire reste le salaire de base : la courbe est neutre.
    expect(curve).toEqual(DEFAULT_LABOR.wage);
    // Une nuit chez les habitants coûte une obole quand la cité loge tous ses travailleurs, jusqu'à un demi-salaire
    // quand elle n'en loge aucun : un travailleur sans logement coûte alors un salaire et demi.
    expect(lodging.baseOboles).toBe(1);
    expect([lodging.minBps, lodging.minBps + lodging.slopeBps]).toEqual([10_000, lodging.maxBps]);
    expect((lodging.baseOboles * lodging.maxBps) / 10_000).toBe(wage / 2);
  });

  it('chaque recette a une capacité d’accumulation d’un à sept jours', () => {
    for (const recipe of config.recipes) {
      expect(recipe.maxAccruedCycles * recipe.durationMinutes).toBeGreaterThanOrEqual(24 * 60);
      expect(recipe.maxAccruedCycles * recipe.durationMinutes).toBeLessThanOrEqual(7 * 24 * 60);
    }
  });

  it('chaque type de site a un entretien quotidien, inférieur à son prix d’acquisition', () => {
    const { acquisitionCostOboles, upkeep } = config.sites;
    // Garde-fou de cohérence, pas une formule d'équilibrage : les montants se règlent librement.
    for (const [type, cost] of Object.entries(acquisitionCostOboles)) {
      const daily = upkeep.dailyOboles[type as keyof typeof upkeep.dailyOboles];
      expect(daily).toBeGreaterThan(0);
      expect(daily).toBeLessThan(cost);
    }
    expect(upkeep.coefficientBps).toBeGreaterThan(0);
  });

  /** Marins de l'équipage de chaque classe de navire : l'entretien d'un jour est leur salaire (#668). */
  const CREW: Record<string, number> = { coaster: 3, round_ship: 8 };

  it('deux classes de navires, entretenues au salaire de leur équipage (#251, #668)', () => {
    expect(config.ships.classes.map((shipClass) => shipClass.id)).toEqual([
      'coaster',
      'round_ship',
    ]);
    for (const shipClass of config.ships.classes)
      expect(shipClass.dailyUpkeepOboles).toBe((CREW[shipClass.id] ?? NaN) * wage);
  });

  it('deux tailles de logement, entretenues et usées, dans chaque cité (#256, #668)', () => {
    const { sizes, countsByCity } = config.properties;
    const { baseOboles, maxBps } = config.labor.lodging;
    expect(sizes.map((size) => size.id)).toEqual(['townhouse', 'tenement']);
    for (const size of sizes) {
      // Une rénovation coûte moins que l'achat.
      expect(size.renovation.oboles).toBeLessThan(size.purchasePriceOboles);
      // L'entretien coûte moins que l'hébergement que le bien évite, même au plus bas.
      expect(size.dailyUpkeepOboles).toBeGreaterThan(0);
      expect(size.dailyUpkeepOboles).toBeLessThan(size.housingUnits * baseOboles);
      // Neuf, le bien passe sous son seuil d'habitabilité en trois à quatre semaines de jeu : une rénovation par mois.
      const days = (10_000 - size.minHabitableCondition) / size.dailyWear;
      expect(days).toBeGreaterThanOrEqual(21);
      expect(days).toBeLessThanOrEqual(28);
      // Au plus fort de la pénurie, ce que le bien évite d'hébergement rembourse son prix en moins d'un an de jeu.
      const saved = (size.housingUnits * baseOboles * maxBps) / 10_000 - size.dailyUpkeepOboles;
      expect(size.purchasePriceOboles / saved).toBeLessThan(365);
    }
    for (const city of config.cities)
      for (const size of sizes) expect(countsByCity[city.id]?.[size.id]).toBeGreaterThan(0);
  });

  it('métèque trois jours, archonte élu pour 28 jours, au plus deux mandats de suite (3, 6.2 ; #260)', () => {
    expect(config.politics).toEqual({
      meticDays: 3,
      archon: { termDays: 28, candidacyDays: 4, votingDays: 3, maxConsecutiveTerms: 2 },
    });
  });

  it('décrets : quatre modèles ouverts, taux et coefficient autour de ceux du monde (6.3 ; #261)', () => {
    const decrees = config.decrees;
    expect(decrees && Object.keys(decrees.models).sort()).toEqual([
      'festival',
      'market_tax_rate',
      'port_dues',
      'public_works',
    ]);
    const rate = decrees?.models.market_tax_rate;
    expect(rate && rate.minRateBps <= config.marketTax.rateBps).toBe(true);
    expect(rate && config.marketTax.rateBps <= rate.maxRateBps).toBe(true);
    const port = decrees?.models.port_dues;
    for (const coefficient of Object.values(config.ships.portDues.cityCoefficientBps))
      expect(
        port && port.minCoefficientBps <= coefficient && coefficient <= port.maxCoefficientBps,
      ).toBe(true);
  });

  it('routes : les six des quatre premières cités, puis les huit autres reliées chacune à au moins deux voisines, l’archipel connexe ; provisions et droit de port (#252, #668, #707)', () => {
    const cities = FOUR_CITIES;
    const pairs = cities.flatMap((a, i) => cities.slice(i + 1).map((b) => [a, b].sort().join(' ')));
    const keys = config.ships.routes.map(({ cities: pair }) => [...pair].sort().join(' '));
    // Les six routes de #252 en tête, inchangées : le banc à quatre cités les joue seules (5.5).
    expect(keys.slice(0, 6).sort()).toEqual(pairs.sort());
    expect(keys).toHaveLength(23);
    const neighbours = (id: string) =>
      config.ships.routes.flatMap(({ cities: [a, b] }) => (a === id ? [b] : b === id ? [a] : []));
    for (const id of [...FOUR_CITIES, ...EIGHT_CITIES])
      expect(neighbours(id).length, id).toBeGreaterThanOrEqual(2);
    // Connexe : de Kallistè, de route en route, on atteint les douze cités.
    const reached = new Set(['kalliste']);
    for (let queue = ['kalliste']; queue.length > 0;) {
      const next = neighbours(queue.shift() ?? '').filter((id) => !reached.has(id));
      for (const id of next) reached.add(id);
      queue.push(...next);
    }
    expect([...reached].sort()).toEqual([...FOUR_CITIES, ...EIGHT_CITIES].sort());
    // Provisions : les vivres de l'équipage pendant la traversée, au coût de la vie d'un habitant (8 oboles par jour),
    // sur la durée du trajet de la classe, arrondies à l'obole supérieure.
    for (const route of config.ships.routes)
      for (const shipClass of config.ships.classes)
        expect(route.provisionsOboles[shipClass.id]).toBe(
          Math.ceil(
            ((CREW[shipClass.id] ?? NaN) * 8 * route.hours * 10_000) / (24 * shipClass.speedBps),
          ),
        );
    // Droit de port : 1 % de la valeur d'une soute pleine de blé à son prix de référence.
    const wheat = config.goods.find((good) => good.id === 'wheat')?.referencePriceOboles ?? NaN;
    for (const shipClass of config.ships.classes)
      expect(config.ships.portDues.byClassOboles[shipClass.id]).toBe(
        (shipClass.capacityUnits * wheat) / 100,
      );
    for (const city of config.cities)
      expect(config.ships.portDues.cityCoefficientBps[city.id]).toBe(10_000);
    // Pertes en mer (#730), paramètres neutres : aucune route ne fait rien perdre, même pendant une tempête.
    for (const route of config.ships.routes)
      expect([routeLossRiskBps(route), routeStormLossRiskBps(route)]).toEqual([0, 0]);
  });

  it('le blé a une demande finale : la première tranche jouable vend du blé aux PNJ (ticket 9)', () => {
    const city = config.cities[0];
    const wheatPerTick = config.npcClasses.reduce((total, npcClass) => {
      const entry = npcClass.basket.find((candidate) => candidate.goodId === 'wheat');
      const population = city?.population[npcClass.id] ?? 0;
      return total + ((entry?.quantityPerThousand ?? 0) * population) / 1000;
    }, 0);
    expect(wheatPerTick).toBeGreaterThan(0);
    expect(config.recipes.filter((recipe) => recipe.id === 'grow_wheat')).toHaveLength(1);
  });

  it('le panier de l’indice des prix est la consommation de référence de Kallistè (5.5)', () => {
    // Six biens principaux, à la consommation d'un jour de la population initiale arrondie à l'unité
    // (#78 : par tick, elle n'est plus que d'une dizaine d'unités, trop peu pour pondérer le panier),
    // soit 88 % de la dépense de référence de la cité depuis les paniers de #713, qui ne changent pas l'indice
    // (97 % avant). Garde-fou : un panier vide rendrait l'indice inconnu.
    const city = config.cities.find((candidate) => candidate.id === 'kalliste');
    if (!city) throw new Error('kalliste missing');
    const consumed = new Map<string, number>();
    for (const npcClass of config.npcClasses) {
      for (const { goodId, quantityPerThousand } of npcClass.basket) {
        const ticksPerDay = 1440 / config.clock.tickMinutes;
        const eaten =
          (quantityPerThousand * (city.population[npcClass.id] ?? 0) * ticksPerDay) / 1000;
        consumed.set(goodId, (consumed.get(goodId) ?? 0) + eaten);
      }
    }
    const { basket } = config.priceIndex;
    expect(basket.map((entry) => entry.goodId)).toEqual([
      'wheat',
      'bread',
      'fish',
      'salt',
      'olive_oil',
      'wine',
    ]);
    for (const { goodId, quantity } of basket) {
      expect([goodId, quantity]).toEqual([goodId, Math.round(consumed.get(goodId) ?? 0)]);
    }
    const price = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
    const spend = (entries: [string, number][]) =>
      entries.reduce((sum, [goodId, quantity]) => sum + quantity * (price.get(goodId) ?? 0), 0);
    const share = spend(basket.map((e) => [e.goodId, e.quantity])) / spend([...consumed]);
    expect(Math.round(share * 100)).toBe(88);
  });

  it('tous les usages d’IA sont coupés au départ : le jeu se joue sans IA (règle 6, paramètres neutres)', () => {
    expect(Object.values(config.ai.usages).every((usage) => !usage.enabled)).toBe(true);
    expect(config.ai.budgetMicroEurosPerActivePlayerMonth).toBe(0);
  });

  it('chaque bien fini est demandé par au moins une classe de PNJ', () => {
    const wanted = new Set(config.npcClasses.flatMap((c) => c.basket.map((entry) => entry.goodId)));
    // Sans exception depuis #713 : un bien fini invendu est nommé ici.
    const unsold = config.goods.filter((good) => good.tier === 'finished' && !wanted.has(good.id));
    expect(unsold.map((good) => good.id)).toEqual([]);
  });

  it('aucune transformation ne détruit de valeur au prix de référence', () => {
    const price = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
    const value = (stacks: { goodId: string; quantity: number }[]) =>
      stacks.reduce((sum, stack) => sum + stack.quantity * (price.get(stack.goodId) ?? 0), 0);
    const losing = config.recipes.filter((r) => value(r.outputs) <= value(r.inputs));
    expect(losing.map((recipe) => recipe.id)).toEqual([]);
  });
});

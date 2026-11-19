import { cityProperties, npcDemand, voyageArrivals } from '@oikos/engine';
import { config, type City, type Role } from './city';
import type { Seller } from './strategy';

/*
 * Banc des quatre cités (#281) : paramètres de scénario et maisons par terroir. Ce sont des choix
 * du banc, pas de l'équilibrage du jeu, qui reste entièrement dans `packages/config` ; le calibrage est
 * l'affaire de #283.
 */
/** Graine de monde du banc des quatre cités, fixée pour que ses tirages soient reproductibles (#267). */
export const WORLD_SEED = 'banc-equilibrage-281';
/** Les quatre cités de la configuration initiale. */
export const SLUGS = ['kalliste', 'elaia', 'ampelos', 'halos'] as const;
/**
 * Diviseur de la population de chaque cité : la demande des PNJ des quatre cités est ainsi, au total, celle
 * de la cité prototype (#78), que 28 maisons couvrent ; le banc reste à la durée d'un banc à une cité.
 */
export const POPULATION_DIVISOR = 4;
/** Mise en route, non mesurée, puis jours mesurés. */
export const WARMUP = 10;
export const MEASURED = 30;
/** Jours d'une fenêtre de moyenne (début et fin de la période mesurée). */
export const WINDOW = 10;

/**
 * Logement du scénario (4.5, #258), neutre dans la configuration initiale : une nuit chez les PNJ coûte 1 obole,
 * jusqu'à trois fois plus quand aucun travailleur n'est logé ; un bien a un entretien
 * et perd 3 % d'état par jour de jeu, donc passe sous son seuil d'habitabilité en 23 jours et se rénove dans le
 * banc. Les prix d'achat et de rénovation de la configuration initiale (3 000 oboles une maison de ville, 20 bois et 30 argile
 * pour la rénover) ne s'amortiraient jamais au prix d'une nuit que les maisons du banc peuvent payer, et dépasseraient
 * la production de bois et d'argile de leurs cités, déjà déficitaires : le banc divise les prix par cinq, et rénove avec du blé, que toutes ses maisons récoltent. Ce sont des paramètres du banc, pas du jeu ; leur calibrage est l'affaire de #668.
 */
export const HOUSING = {
  lodging: { baseOboles: 1, minBps: 10_000, maxBps: 30_000, slopeBps: 20_000 },
  upkeepOboles: { townhouse: 1, tenement: 3 } as Record<string, number>,
  dailyWear: 300,
  priceDivisor: 5,
  renovationWheat: { townhouse: 50, tenement: 150 } as Record<string, number>,
};

/**
 * Configuration jouée : celle du banc, à la population près de chaque cité et au logement du scénario. Les salaires des
 * travailleurs et des intendants sont ceux de la configuration (4.4, #283).
 */
export const worldConfig = {
  ...config,
  labor: { ...config.labor, lodging: HOUSING.lodging },
  properties: {
    ...config.properties,
    sizes: config.properties.sizes.map((size) => ({
      ...size,
      purchasePriceOboles: size.purchasePriceOboles / HOUSING.priceDivisor,
      dailyUpkeepOboles: HOUSING.upkeepOboles[size.id] ?? 0,
      dailyWear: HOUSING.dailyWear,
      renovation: {
        oboles: size.renovation.oboles / HOUSING.priceDivisor,
        goods: [{ goodId: 'wheat', quantity: HOUSING.renovationWheat[size.id] ?? 0 }],
      },
    })),
  },
  cities: config.cities.map((city) => ({
    ...city,
    population: Object.fromEntries(
      Object.entries(city.population).map(([id, count]) => [
        id,
        Math.round(count / POPULATION_DIVISOR),
      ]),
    ),
  })),
};

/** Maisons d'un rôle : leur nombre, puis leurs sites dans l'ordre d'acquisition. */
const role = (name: string, count: number, ...sites: string[]): Role => ({ name, count, sites });
/**
 * Maisons scriptées de chaque cité, selon son terroir et la demande de ses PNJ (une cité vit ici de ce
 * qu'elle produit) : le premier site est celui de la fondation (la recette de départ de la cité), les
 * autres suivent dans l'ordre d'acquisition. Les ateliers sont admis partout, les productions primaires
 * seulement dans le terroir de la cité. Nombres choisis à la main pour que la production de chaque cité
 * couvre à peu près sa demande de référence : une communauté plausible, pas une stratégie optimale.
 */
export const SETTLEMENTS: Record<(typeof SLUGS)[number], Role[]> = {
  kalliste: [
    role('meunier-boulanger', 1, 'grow_wheat', 'mill_flour', 'mill_flour', 'bake_bread'),
    role('boulanger', 1, 'grow_wheat', 'bake_bread', 'bake_bread', 'bake_bread'),
    role('charbonnier-bûcheron', 1, 'grow_wheat', 'burn_charcoal', 'burn_charcoal', 'fell_wood'),
    role('oléiculteur', 1, 'grow_wheat', 'grow_olives', 'grow_olives', 'press_oil'),
    role('vigneron', 1, 'grow_wheat', 'grow_grapes', 'ferment_wine', 'ferment_wine'),
    role('pêcheur-saunier', 1, 'grow_wheat', 'catch_fish', 'catch_fish', 'rake_salt'),
    role('potier', 1, 'grow_wheat', 'throw_amphorae', 'dig_clay', 'throw_amphorae'),
  ],
  elaia: [
    role('meunier-boulanger', 1, 'grow_wheat', 'mill_flour', 'mill_flour', 'bake_bread'),
    role('boulanger', 1, 'grow_wheat', 'bake_bread', 'bake_bread', 'bake_bread'),
    role('charbonnier-bûcheron', 1, 'grow_wheat', 'burn_charcoal', 'burn_charcoal', 'fell_wood'),
    role('oléiculteur', 1, 'grow_wheat', 'grow_olives', 'grow_olives', 'press_oil'),
    role('saunier', 1, 'grow_wheat', 'rake_salt'),
    role('fermier', 2, 'grow_wheat'),
  ],
  ampelos: [role('pêcheur', 2, 'grow_grapes', 'catch_fish', 'catch_fish')],
  halos: [
    role('pêcheur', 1, 'catch_fish', 'catch_fish'),
    role('pêcheur-saunier', 1, 'catch_fish', 'rake_salt'),
  ],
};

/** Une cité du banc et ses maisons scriptées. */
export interface Settlement {
  city: City;
  houses: Seller[];
}

/** Cités d'attache des négociants (leur navire y naît) : une maison chacune, sans autre site que celui de la fondation. */
export const TRADER_HOMES = ['kalliste', 'elaia', 'halos'] as const;
export const TRADER: Role = { name: 'négociant', count: 1, sites: [], trader: true };
/** Étapes des ticks du banc : le parc de logements des cités (4.5), la demande des PNJ, puis l'arrivée des voyages (4.6). */
export const WORLD_STEPS = [cityProperties, npcDemand, voyageArrivals];

/** Maisons qui confient la vente de leurs récoltes à un intendant, par nom de rôle. */
export const STEWARD_ROLES = ['fermier', 'pêcheur', 'pêcheur-saunier'];

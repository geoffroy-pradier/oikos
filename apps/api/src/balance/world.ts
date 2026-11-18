import { npcDemand, voyageArrivals } from '@oikos/engine';
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

/** Configuration jouée : celle du banc, à la population près de chaque cité. */
export const worldConfig = {
  ...config,
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
/** Étapes des ticks du banc : la demande des PNJ, puis l'arrivée des voyages (4.6). */
export const WORLD_STEPS = [npcDemand, voyageArrivals];

import { cityProperties, npcDemand, voyageArrivals } from '@oikos/engine';
import { config, recipeOf, type City, type Role } from './city';
import type { Seller } from './strategy';

/*
 * Banc des douze cités (#281, #283, #712) : paramètres de scénario, maisons par terroir et armateurs. Ce sont des
 * choix du banc, pas de l'équilibrage du jeu, qui reste entièrement dans `packages/config`.
 */
/** Graine de monde du banc, fixée pour que ses tirages soient reproductibles (#267). */
export const WORLD_SEED = 'banc-equilibrage-281';
/** Les douze cités de la configuration initiale, dans son ordre. */
export const SLUGS = [
  'kalliste',
  'elaia',
  'ampelos',
  'halos',
  'dikaia',
  'gamelia',
  'delphis',
  'agrotera',
  'phrourion',
  'myrrhine',
  'chalkeia',
  'emporion',
] as const;
export type Slug = (typeof SLUGS)[number];
/** Les quatre premières cités, celles du banc de #283, qui gardent leur scénario. */
const FIRST_FOUR: readonly Slug[] = ['kalliste', 'elaia', 'ampelos', 'halos'];
/**
 * Diviseur de la population de chaque cité : une cité de 1 250 habitants, que sept ou huit maisons couvrent, pour les
 * quatre premières (#283). Les huit cités de #706 sont trois fois plus petites (417 habitants) : leur demande tient
 * dans les sites d'une à cinq maisons et dans la soute d'un caboteur, et le banc dans la durée du job `balance` (#712).
 */
export const POPULATION_DIVISOR = 8;
export const NEW_CITY_POPULATION_DIVISOR = 24;
export const populationDivisor = (slug: string) =>
  (FIRST_FOUR as readonly string[]).includes(slug)
    ? POPULATION_DIVISOR
    : NEW_CITY_POPULATION_DIVISOR;
/** Mise en route, non mesurée, puis jours mesurés. */
export const WARMUP = 10;
export const MEASURED = 30;
/** Jours d'une fenêtre de moyenne (début et fin de la période mesurée). */
export const WINDOW = 10;

/**
 * Logement du scénario (4.5) : l'hébergement, l'entretien et la vétusté sont ceux de la configuration initiale (#668).
 * Ses prix d'achat et de rénovation (3 000 oboles une maison de ville ; 300 oboles, 20 bois et 30 argile pour la rénover)
 * s'amortissent en plus de cent jours, au-delà des 40 que joue le banc, et ses cités ne produisent pas assez de bois
 * et d'argile pour leurs ateliers : le banc divise les prix par cinq, pour que ses maisons achètent, louent et rénovent
 * pendant la partie, et rénove avec du blé, que toutes ses maisons récoltent. Ce sont des paramètres du banc, pas du
 * jeu.
 */
export const HOUSING = {
  priceDivisor: 5,
  renovationWheat: { townhouse: 50, tenement: 150 } as Record<string, number>,
};

/**
 * Dotation de départ de chaque maison du scénario, en oboles : de quoi acquérir son portefeuille de sites dès ses
 * premiers jours et tenir en séquestre une journée d'intrants à leur prix d'achat le plus haut sans tomber sous sa
 * réserve (un boulanger : 3 000 oboles de sites, 6 500 de farine, 1 700 de charbon) ; pour un armateur, son navire et
 * deux jours de cargaison. Le banc mesure un monde en régime, pas sa mise en route. C'est un paramètre du banc, pas du
 * jeu.
 */
export const GRANT_OBOLES = 15_000;

/**
 * Configuration jouée : celle du banc, à la population près de chaque cité, à la dotation et aux prix des logements
 * du scénario. Salaires, marché du travail, transport, événements et grâces sont ceux de la configuration (#668), et
 * ses douze cités, leurs routes (#707) comprises.
 */
export const worldConfig = {
  ...config,
  starting: { ...config.starting, grantOboles: GRANT_OBOLES },
  properties: {
    ...config.properties,
    sizes: config.properties.sizes.map((size) => ({
      ...size,
      purchasePriceOboles: size.purchasePriceOboles / HOUSING.priceDivisor,
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
        Math.round(count / populationDivisor(city.id)),
      ]),
    ),
  })),
};

/** Maisons d'un rôle : leur nombre, puis leurs sites dans l'ordre d'acquisition. */
const role = (name: string, count: number, ...sites: string[]): Role => ({ name, count, sites });
/**
 * Maisons scriptées de chaque cité, selon son terroir : le premier site est celui de la fondation (la recette de
 * départ de la cité), les autres suivent dans l'ordre d'acquisition. Les ateliers sont admis partout, les productions
 * primaires seulement dans le terroir de la cité. Kallistè et Elaia produisent pour elles et pour Ampélos et Halos, que
 * les armateurs ravitaillent : de 104 à 121 % de la demande de blé des PNJ, des moulins et des armateurs, deux moulins
 * pour le pain (512 par jour, un peu sous la demande), un pressoir et, à Kallistè, cinq chais pour l'huile et le vin,
 * rares. Ampélos et Halos pêchent leur poisson, Halos raffine son sel. Chaque maison confie ses récoltes à un
 * intendant (`balance/steward.ts`). Nombres choisis à la main : une communauté plausible, pas une stratégie optimale.
 * Dans les huit cités de #706 (#712), trois foyers font le blé, le pain et le vin de leurs voisines : Dikaia pour
 * Delphis, Gamelia pour Emporion, Phrourion pour Myrrhinè, Agrotera et Chalkeia (le pain et le vin) ; un moulin pour
 * deux cités (192 pains par jour pour 174), de 131 % à 197 % de la demande de blé. À Dikaia et Gamelia, le boulanger
 * cuit son charbon et le garde : vendu, le surplus d'une charbonnière (64 par jour pour 36) ferait tomber le prix du
 * charbon du monde, et la marge de la filière sous sa borne (#285). Delphis, Emporion, Myrrhinè, Chalkeia et Agrotera
 * ont une maison chacune : huile, poisson, sel, raisin selon leur terroir. Une maison de plus à Halos y coupe le bois et
 * tire l'argile du pain et des amphores de Gamelia, qui n'en a pas.
 */
export const SETTLEMENTS: Record<Slug, Role[]> = {
  kalliste: [
    role('meunier-boulanger', 1, 'grow_wheat', 'mill_flour', 'mill_flour', 'bake_bread'),
    role('boulanger', 1, 'grow_wheat', 'bake_bread', 'bake_bread', 'bake_bread'),
    role('charbonnier-bûcheron', 1, 'grow_wheat', 'burn_charcoal', 'burn_charcoal', 'fell_wood'),
    role('arboriculteur', 1, 'grow_wheat', 'grow_olives', 'grow_olives', 'grow_grapes'),
    role('presseur-caviste', 1, 'grow_wheat', 'press_oil', 'ferment_wine', 'ferment_wine'),
    role('pêcheur-saunier', 1, 'grow_wheat', 'catch_fish', 'rake_salt', 'ferment_wine'),
    role('potier', 1, 'grow_wheat', 'throw_amphorae', 'dig_clay', 'ferment_wine'),
    role('fermier-caviste', 1, 'grow_wheat', 'ferment_wine'),
  ],
  elaia: [
    role('meunier-boulanger', 1, 'grow_wheat', 'mill_flour', 'mill_flour', 'bake_bread'),
    role('boulanger', 1, 'grow_wheat', 'bake_bread', 'bake_bread', 'bake_bread'),
    role('charbonnier-bûcheron', 1, 'grow_wheat', 'burn_charcoal', 'burn_charcoal', 'fell_wood'),
    role('oléiculteur', 1, 'grow_wheat', 'grow_olives', 'grow_olives', 'press_oil'),
    role('saunier', 1, 'grow_wheat', 'rake_salt'),
    role('fermier', 2, 'grow_wheat'),
  ],
  ampelos: [role('pêcheur', 1, 'grow_grapes', 'catch_fish', 'catch_fish')],
  halos: [
    role('pêcheur', 1, 'catch_fish', 'catch_fish'),
    role('pêcheur-saunier', 1, 'catch_fish', 'rake_salt'),
    role('bûcheron-argilier', 1, 'catch_fish', 'fell_wood', 'dig_clay'),
  ],
  dikaia: [
    role('meunier', 1, 'grow_wheat', 'mill_flour'),
    role('boulanger-potier', 1, 'grow_wheat', 'burn_charcoal', 'bake_bread', 'throw_amphorae'),
    role('bûcheron-argilier', 1, 'grow_wheat', 'fell_wood', 'dig_clay'),
    role('caviste', 1, 'grow_wheat', 'ferment_wine'),
  ],
  gamelia: [
    role('meunier', 1, 'grow_wheat', 'mill_flour'),
    role('boulanger-potier', 1, 'grow_wheat', 'burn_charcoal', 'bake_bread', 'throw_amphorae'),
    role('vigneron-caviste', 1, 'grow_wheat', 'grow_grapes', 'ferment_wine'),
    role('oléiculteur', 1, 'grow_wheat', 'grow_olives', 'press_oil'),
  ],
  delphis: [role('vigneron-oléiculteur', 1, 'grow_olives', 'grow_grapes', 'press_oil')],
  agrotera: [role('fermier-oléiculteur', 1, 'fell_wood', 'grow_wheat', 'grow_olives', 'press_oil')],
  phrourion: [
    role('meunier-boulanger', 2, 'grow_wheat', 'mill_flour', 'bake_bread'),
    role('charbonnier', 1, 'grow_wheat', 'fell_wood', 'burn_charcoal'),
    role('potier-caviste', 1, 'grow_wheat', 'dig_clay', 'throw_amphorae', 'ferment_wine'),
    role('caviste', 1, 'grow_wheat', 'ferment_wine', 'ferment_wine', 'ferment_wine'),
  ],
  myrrhine: [role('pêcheur', 1, 'grow_grapes', 'catch_fish', 'catch_fish')],
  chalkeia: [role('saunier-oléiculteur', 1, 'fell_wood', 'rake_salt', 'grow_olives', 'press_oil')],
  emporion: [role('pêcheur-saunier', 1, 'catch_fish', 'rake_salt')],
};

/**
 * Armateurs (#283) : des maisons de la cité qu'elles ravitaillent, qui y naissent avec son site de départ, arment
 * chacune un caboteur et font la navette avec leur cité source. Vers leur cité, elles portent ce qu'elle ne produit pas ;
 * vers la source, ce que leur cité produit pour elle (le poisson d'Halos pour Elaia). Trois caboteurs pour chaque cité
 * importatrice, qui en demande près de 900 unités par jour, à quatre ou huit heures de mer ; un pour le vin d'Elaia
 * et d'Halos. Dans les huit cités de #706 (#712), un caboteur par cité qui importe, et un relais : ce qu'un armateur
 * porte d'une cité vers une autre, un autre l'y porte d'abord pour elle (le sel d'Elaia pour Dikaia, par Delphis), la
 * demande de la cité de relais comptant la sienne (`relayed`). Chalkeia, qu'aucune cité à blé ne borde, est ravitaillée
 * de Phrourion par une escale à Myrrhinè (`via`, 4.6), où l'armateur ne vend ni n'achète rien.
 */
export const CARRIERS: {
  home: Slug;
  source: Slug;
  /** Escale entre les deux, sans route directe. */
  via?: Slug;
  count: number;
  toHome: string[];
  toSource: string[];
}[] = [
  {
    home: 'ampelos',
    source: 'kalliste',
    count: 3,
    toHome: ['wheat', 'bread', 'salt', 'olive_oil', 'wine'],
    toSource: [],
  },
  {
    home: 'halos',
    source: 'elaia',
    count: 3,
    toHome: ['wheat', 'bread', 'olive_oil'],
    toSource: ['fish'],
  },
  { home: 'elaia', source: 'kalliste', count: 1, toHome: ['wine'], toSource: [] },
  { home: 'halos', source: 'kalliste', count: 1, toHome: ['wine'], toSource: [] },
  {
    home: 'delphis',
    source: 'dikaia',
    count: 1,
    toHome: ['wheat', 'bread', 'wine', 'fish'],
    toSource: ['olive_oil', 'grapes', 'salt'],
  },
  { home: 'dikaia', source: 'ampelos', count: 1, toHome: ['fish'], toSource: [] },
  { home: 'delphis', source: 'elaia', count: 1, toHome: ['salt'], toSource: [] },
  {
    home: 'emporion',
    source: 'gamelia',
    count: 1,
    toHome: ['wheat', 'bread', 'wine', 'olive_oil'],
    toSource: ['fish', 'salt'],
  },
  { home: 'gamelia', source: 'halos', count: 1, toHome: ['wood', 'clay'], toSource: [] },
  {
    home: 'myrrhine',
    source: 'phrourion',
    count: 1,
    toHome: ['wheat', 'bread', 'wine', 'salt', 'olive_oil'],
    toSource: ['fish', 'grapes'],
  },
  {
    home: 'chalkeia',
    source: 'phrourion',
    via: 'myrrhine',
    count: 1,
    toHome: ['wheat', 'bread', 'wine', 'fish'],
    toSource: ['salt', 'olive_oil'],
  },
  {
    home: 'agrotera',
    source: 'phrourion',
    count: 1,
    toHome: ['bread', 'wine', 'fish', 'salt'],
    toSource: [],
  },
];
export const CARRIER: Role = { name: 'armateur', count: 1, sites: [] };

/**
 * Logement (#712) : dans les huit cités de #706, une maison qui ne récolte pas de blé n'achète pas de bien, elle le
 * rénoverait avec le blé de ses PNJ (un immeuble en demande 150, la cité 183 par jour) ; elle loue. Un armateur loue.
 */
export const buysProperties = (slug: string, role: Role) =>
  (FIRST_FOUR as readonly string[]).includes(slug) ||
  role.sites.some((id) => recipeOf(id).outputs.some((stack) => stack.goodId === 'wheat'));

/** Une cité du banc et ses maisons scriptées. */
export interface Settlement {
  city: City;
  houses: Seller[];
}

/** Étapes des ticks du banc : le parc de logements des cités (4.5), la demande des PNJ, puis l'arrivée des voyages (4.6). */
export const WORLD_STEPS = [cityProperties, npcDemand, voyageArrivals];

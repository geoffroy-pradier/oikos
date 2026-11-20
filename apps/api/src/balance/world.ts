import { cityProperties, npcDemand, voyageArrivals } from '@oikos/engine';
import { config, type City, type Role } from './city';
import type { Seller } from './strategy';

/*
 * Bancs des quatre et des douze cités (#281, #283, #712) : paramètres de scénario, maisons par terroir et armateurs.
 * Ce sont des choix du banc, pas de l'équilibrage du jeu, qui reste entièrement dans `packages/config`. Le scénario
 * joué est celui des quatre cités, ou celui des douze si `BALANCE_SCENARIO` vaut `twelve` (banc de nuit, 5.5).
 */
/** Graine de monde du banc des quatre cités, fixée pour que ses tirages soient reproductibles (#267). */
export const WORLD_SEED = 'banc-equilibrage-281';
/** Les quatre premières cités de la configuration initiale. */
const FOUR_SLUGS = ['kalliste', 'elaia', 'ampelos', 'halos'] as const;
export type Slug = string;
/**
 * Diviseur de la population de chaque cité : une cité de 1 250 habitants, que sept ou huit maisons couvrent, et la
 * demande des quatre cités vaut la moitié de celle de la cité prototype (#78) ; le banc, avec ses armateurs, reste
 * ainsi à la durée d'un banc à une cité.
 */
export const POPULATION_DIVISOR = 8;
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

/** Garde, des tables par cité de la configuration, les entrées des quatre cités du scénario. */
const ofScenario = <T>(byCity: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(byCity).filter(([id]) => (FOUR_SLUGS as readonly string[]).includes(id)),
  );

/**
 * Configuration jouée : celle du banc, à la population près de chaque cité, à la dotation et aux prix des logements
 * du scénario. Salaires, marché du travail, transport, événements et grâces sont ceux de la configuration (#668).
 * Depuis #706, la configuration initiale compte douze cités : le banc n'en joue que quatre et retire les huit autres
 * (cités, salaires, droits de port, parc de logements, et depuis #707 leurs routes) jusqu'au banc à douze cités
 * (« P10 ») ; leurs mesures et leurs bornes sont celles d'avant : ses routes sont les six qui relient ces quatre cités.
 */
const fourConfig = {
  ...config,
  staff: { ...config.staff, dailyWageOboles: ofScenario(config.staff.dailyWageOboles) },
  ships: {
    ...config.ships,
    routes: config.ships.routes.filter(({ cities }) =>
      cities.every((id) => (FOUR_SLUGS as readonly string[]).includes(id)),
    ),
    portDues: {
      ...config.ships.portDues,
      cityCoefficientBps: ofScenario(config.ships.portDues.cityCoefficientBps),
    },
  },
  starting: { ...config.starting, grantOboles: GRANT_OBOLES },
  properties: {
    ...config.properties,
    countsByCity: ofScenario(config.properties.countsByCity),
    sizes: config.properties.sizes.map((size) => ({
      ...size,
      purchasePriceOboles: size.purchasePriceOboles / HOUSING.priceDivisor,
      renovation: {
        oboles: size.renovation.oboles / HOUSING.priceDivisor,
        goods: [{ goodId: 'wheat', quantity: HOUSING.renovationWheat[size.id] ?? 0 }],
      },
    })),
  },
  cities: config.cities
    .filter((city) => (FOUR_SLUGS as readonly string[]).includes(city.id))
    .map((city) => ({
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
 * Maisons scriptées de chaque cité, selon son terroir : le premier site est celui de la fondation (la recette de
 * départ de la cité), les autres suivent dans l'ordre d'acquisition. Les ateliers sont admis partout, les productions
 * primaires seulement dans le terroir de la cité. Kallistè et Elaia produisent pour elles et pour Ampélos et Halos, que
 * les armateurs ravitaillent : de 104 à 121 % de la demande de blé des PNJ, des moulins et des armateurs, deux moulins
 * pour le pain (512 par jour, un peu sous la demande), un pressoir et, à Kallistè, cinq chais pour l'huile et le vin,
 * rares. Ampélos, Halos et Kallistè (deux sites, #714) pêchent leur poisson ; Elaia et Halos raffinent le sel, que
 * Kallistè n'a plus à son terroir. Chaque maison confie ses récoltes à un
 * intendant (`balance/steward.ts`). Nombres choisis à la main : une communauté plausible, pas une stratégie optimale.
 */
const FOUR_SETTLEMENTS: Record<string, Role[]> = {
  kalliste: [
    role('meunier-boulanger', 1, 'grow_wheat', 'mill_flour', 'mill_flour', 'bake_bread'),
    role('boulanger', 1, 'grow_wheat', 'bake_bread', 'bake_bread', 'bake_bread'),
    role('charbonnier-bûcheron', 1, 'grow_wheat', 'burn_charcoal', 'burn_charcoal', 'fell_wood'),
    role('arboriculteur', 1, 'grow_wheat', 'grow_olives', 'grow_olives', 'grow_grapes'),
    role('presseur-caviste', 1, 'grow_wheat', 'press_oil', 'ferment_wine', 'ferment_wine'),
    role('pêcheur', 1, 'grow_wheat', 'catch_fish', 'catch_fish', 'ferment_wine'),
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
  ],
};

/**
 * Armateurs (#283) : des maisons de la cité qu'elles ravitaillent, qui y naissent avec son site de départ, arment
 * chacune un caboteur et font la navette avec leur cité source. Vers leur cité, elles portent ce qu'elle ne produit pas ;
 * vers la source, ce que leur cité produit pour elle (le poisson d'Halos pour Elaia). Trois caboteurs pour chaque cité
 * importatrice, qui en demande près de 900 unités par jour, à quatre ou huit heures de mer ; un pour le vin d'Elaia
 * et d'Halos ; un pour le sel, d'Elaia vers Kallistè et d'Halos vers Ampélos (#714).
 */
export interface CarrierSpec {
  home: Slug;
  source: Slug;
  /** Escale entre les deux, sans route directe (#712) : l'armateur n'y vend ni n'achète rien. */
  via?: Slug;
  count: number;
  toHome: string[];
  toSource: string[];
}
const FOUR_CARRIERS: CarrierSpec[] = [
  {
    home: 'ampelos',
    source: 'kalliste',
    count: 3,
    toHome: ['wheat', 'bread', 'olive_oil', 'wine'],
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
  { home: 'kalliste', source: 'elaia', count: 1, toHome: ['salt'], toSource: [] },
  { home: 'ampelos', source: 'halos', count: 1, toHome: ['salt'], toSource: [] },
];
export const CARRIER: Role = { name: 'armateur', count: 1, sites: [] };

/**
 * Scénario des douze cités (#712) : la configuration initiale entière, ses vingt-trois routes (#707) et la population de
 * chaque cité divisée par huit, comme celle des quatre premières, qui gardent leurs maisons et leurs armateurs. Dikaia
 * fait le blé, le pain et le vin de Delphis, Gamelia ceux d'Emporion, Phrourion ceux de Myrrhinè et de Chalkeia, comme
 * Elaia pour Halos : deux moulins pour deux cités (512 pains par jour pour 518), quatre pour trois (960 pour 777, cinq
 * fours), 131 % de la demande de blé.
 * Le boulanger cuit son charbon et le garde : vendu, le surplus d'une charbonnière ferait tomber le prix du charbon du
 * monde, et la marge de la filière sous sa borne (#285). Delphis, Emporion, Myrrhinè et Chalkeia pressent l'huile, pêchent
 * ou raffinent le sel de leurs voisines ; Agrotera fait son pain. Une maison de plus pêche à Ampélos, une autre coupe le
 * bois et tire l'argile de Gamelia à Halos.
 */
const TWELVE_SETTLEMENTS: Record<string, Role[]> = {
  ...FOUR_SETTLEMENTS,
  ampelos: [role('pêcheur', 2, 'grow_grapes', 'catch_fish', 'catch_fish')],
  halos: [
    ...(FOUR_SETTLEMENTS['halos'] ?? []),
    role('bûcheron-argilier', 1, 'catch_fish', 'fell_wood', 'fell_wood', 'dig_clay'),
  ],
  dikaia: [
    role('meunier', 2, 'grow_wheat', 'mill_flour'),
    role('boulanger', 1, 'grow_wheat', 'burn_charcoal', 'bake_bread', 'bake_bread'),
    role('boulanger-potier', 1, 'grow_wheat', 'burn_charcoal', 'bake_bread', 'throw_amphorae'),
    role('bûcheron-argilier', 1, 'grow_wheat', 'fell_wood', 'fell_wood', 'dig_clay'),
    role('caviste', 1, 'grow_wheat', 'ferment_wine', 'ferment_wine', 'ferment_wine'),
    role('fermier', 2, 'grow_wheat'),
  ],
  delphis: [
    role('oléiculteur', 1, 'grow_olives', 'grow_olives', 'press_oil', 'press_oil'),
    role('vigneron', 1, 'grow_olives', 'grow_grapes'),
  ],
  gamelia: [
    role('meunier', 2, 'grow_wheat', 'mill_flour'),
    role('boulanger', 1, 'grow_wheat', 'burn_charcoal', 'bake_bread', 'bake_bread'),
    role('boulanger-potier', 1, 'grow_wheat', 'burn_charcoal', 'bake_bread', 'throw_amphorae'),
    role('vigneron-caviste', 1, 'grow_wheat', 'grow_grapes', 'ferment_wine', 'ferment_wine'),
    role('oléiculteur', 1, 'grow_wheat', 'grow_olives', 'press_oil'),
    role('fermier', 2, 'grow_wheat'),
  ],
  emporion: [role('pêcheur-saunier', 1, 'catch_fish', 'catch_fish', 'rake_salt')],
  phrourion: [
    role('meunier', 4, 'grow_wheat', 'mill_flour'),
    role('boulanger', 2, 'grow_wheat', 'burn_charcoal', 'bake_bread', 'bake_bread'),
    role('boulanger-potier', 1, 'grow_wheat', 'burn_charcoal', 'bake_bread', 'throw_amphorae'),
    role('caviste', 2, 'grow_wheat', 'ferment_wine', 'ferment_wine', 'ferment_wine'),
    role('bûcheron-argilier', 2, 'grow_wheat', 'fell_wood', 'fell_wood', 'dig_clay'),
    role('fermier', 2, 'grow_wheat'),
  ],
  myrrhine: [role('pêcheur', 2, 'grow_grapes', 'catch_fish', 'catch_fish')],
  chalkeia: [
    role('saunier-oléiculteur', 1, 'fell_wood', 'rake_salt', 'grow_olives', 'press_oil'),
    role('oléiculteur', 1, 'fell_wood', 'grow_olives', 'grow_olives', 'press_oil'),
  ],
  agrotera: [
    role('meunier', 1, 'fell_wood', 'grow_wheat', 'mill_flour'),
    role('boulanger', 1, 'fell_wood', 'burn_charcoal', 'bake_bread', 'bake_bread'),
    role('fermier', 1, 'fell_wood', 'grow_wheat', 'grow_wheat', 'grow_olives'),
    role('oléiculteur', 1, 'fell_wood', 'grow_wheat', 'grow_olives', 'press_oil'),
  ],
};
/**
 * Armateurs des douze cités (#712), en plus de ceux des quatre : trois caboteurs pour chaque cité ravitaillée en blé et
 * en pain, quatre pour Chalkeia, qu'aucune cité à blé ne borde, par une escale à Myrrhinè (4.6), un pour le reste. Un
 * relais porte pour une autre cité ce qu'un second armateur y apporte (le sel d'Elaia pour Dikaia, par Delphis) : la
 * demande de la cité de relais compte celle de la cité servie (`run.ts`).
 */
const TWELVE_CARRIERS: CarrierSpec[] = [
  ...FOUR_CARRIERS,
  {
    home: 'delphis',
    source: 'dikaia',
    count: 3,
    toHome: ['wheat', 'bread', 'wine', 'fish'],
    toSource: ['olive_oil', 'grapes', 'salt'],
  },
  { home: 'dikaia', source: 'ampelos', count: 1, toHome: ['fish'], toSource: [] },
  { home: 'delphis', source: 'elaia', count: 1, toHome: ['salt'], toSource: [] },
  {
    home: 'emporion',
    source: 'gamelia',
    count: 3,
    toHome: ['wheat', 'bread', 'wine', 'olive_oil'],
    toSource: ['fish', 'salt'],
  },
  { home: 'gamelia', source: 'halos', count: 1, toHome: ['wood', 'clay'], toSource: [] },
  {
    home: 'myrrhine',
    source: 'phrourion',
    count: 3,
    toHome: ['wheat', 'bread', 'wine', 'salt', 'olive_oil'],
    toSource: ['fish', 'grapes'],
  },
  {
    home: 'chalkeia',
    source: 'phrourion',
    via: 'myrrhine',
    count: 4,
    toHome: ['wheat', 'bread', 'wine', 'fish'],
    toSource: ['salt', 'olive_oil'],
  },
  {
    home: 'agrotera',
    source: 'phrourion',
    count: 1,
    toHome: ['wine', 'fish', 'salt'],
    toSource: [],
  },
];
const twelveConfig = {
  ...fourConfig,
  staff: config.staff,
  ships: config.ships,
  properties: { ...fourConfig.properties, countsByCity: config.properties.countsByCity },
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

/**
 * Un scénario du banc : ses cités, leurs maisons, ses armateurs, sa configuration, et les durées maximales, en minutes,
 * du banc et du test du simulateur (`simulate.bench.ts`).
 */
export const SCENARIOS = {
  four: {
    name: 'quatre cités',
    slugs: FOUR_SLUGS as readonly Slug[],
    settlements: FOUR_SETTLEMENTS,
    carriers: FOUR_CARRIERS,
    config: fourConfig,
    maxMinutes: 15,
    simulatorMinutes: 10,
  },
  twelve: {
    name: 'douze cités',
    slugs: config.cities.map((city) => city.id) as readonly Slug[],
    settlements: TWELVE_SETTLEMENTS,
    carriers: TWELVE_CARRIERS,
    config: twelveConfig,
    maxMinutes: 45,
    simulatorMinutes: 30,
  },
};
/** Scénario joué : celui des quatre cités, sauf `BALANCE_SCENARIO=twelve` (banc de nuit). */
export const SCENARIO =
  process.env['BALANCE_SCENARIO'] === 'twelve' ? SCENARIOS.twelve : SCENARIOS.four;
export const SLUGS = SCENARIO.slugs;
export const SETTLEMENTS = SCENARIO.settlements;
export const CARRIERS = SCENARIO.carriers;
export const worldConfig = SCENARIO.config;

/** Une cité du banc et ses maisons scriptées. */
export interface Settlement {
  city: City;
  houses: Seller[];
}

/** Étapes des ticks du banc : le parc de logements des cités (4.5), la demande des PNJ, puis l'arrivée des voyages (4.6). */
export const WORLD_STEPS = [cityProperties, npcDemand, voyageArrivals];

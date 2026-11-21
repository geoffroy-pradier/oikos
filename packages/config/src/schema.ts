import { z } from 'zod';
import { banksSchema } from './banks';
import { decreesIssues, decreesSchema } from './decrees';
import { graceSchema, gracesIssues } from './graces';
import { honorSchema } from './honor';
import { hubrisSchema } from './hubris';
import { liturgiesSchema } from './liturgies';
import { filterForm } from './moderation';
import { npcHousesIssues, npcHousesSchema, npcRetreatSchema } from './npc-houses';
import { oracleIssues, oracleSchema } from './oracle';
import { stewardsSchema } from './stewards';
import { templeTreasurySchema } from './temple-treasury';
// Lu aussi par le client (`site_rules`, clé `stewards`), qui n'importe que ce module.
export { DEFAULT_STEWARD_REFUSAL_REST_TICKS } from './stewards';
import { worldEventsIssues, worldEventsSchema } from './world-events';

/** Identifiant stable d'une ligne de configuration : minuscules, chiffres, tirets bas. */
const id = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const positiveInt = z.number().int().positive();
const MINUTES_PER_DAY = 1440;
/** Constante de l'univers, pas d'équilibrage (docs/glossary.md) : 6 oboles font 1 drachme. */
export const OBOLS_PER_DRACHMA = 6;

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value === 'UTC' || (value.trim() === value && value.includes('/'));
  } catch {
    return false;
  }
}

export const GOOD_TIERS = ['raw', 'intermediate', 'finished', 'service'] as const;
export const SITE_TYPES = [
  'field',
  'orchard',
  'pasture',
  'forest',
  'quarry',
  'fishery',
  'workshop',
] as const;
export const NEED_LEVELS = ['vital', 'comfort', 'luxury'] as const;

/** Un bien du catalogue (docs/specs/05-economie.md, 5.1). */
export const goodSchema = z.strictObject({
  id,
  tier: z.enum(GOOD_TIERS),
  /** Prix de référence initial, en oboles. */
  referencePriceOboles: positiveInt,
  /** Élasticité-prix ε de la demande finale (5.2). */
  elasticity: z.number().positive().max(5),
});

const stack = z.strictObject({ goodId: id, quantity: positiveInt });

/**
 * Une recette : intrants, durée, personnel, extrants (4.3). Une recette sans intrant est une production primaire.
 * Lue par les joueurs (vue `public.site_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const recipeSchema = z.strictObject({
  id,
  siteType: z.enum(SITE_TYPES),
  inputs: z.array(stack),
  outputs: z.array(stack).min(1),
  durationMinutes: positiveInt,
  workers: z.number().int().nonnegative(),
  /** Capacité de stockage du site : nombre de cycles accumulés au plus en l'absence du joueur. */
  maxAccruedCycles: positiveInt,
});

/**
 * Part publique d'une classe dont la version de configuration ne la donne pas (#632) : le revenu d'un jour entier,
 * soit, pour un monde en service, le comportement d'avant la bourse (décision de #632, comme la règle de #621 : une
 * version publiée garde son comportement). Le calibrage de #283 baissera cette part par une version nouvelle.
 */
export const DEFAULT_NPC_PUBLIC_INCOME_BPS = 10_000;
/** Part publique d'une classe : la sienne, sinon celle d'une version publiée avant le paramètre. */
export const npcPublicIncomeBps = (npcClass: { publicIncomeBps?: number | undefined }) =>
  npcClass.publicIncomeBps ?? DEFAULT_NPC_PUBLIC_INCOME_BPS;

/** Une classe de revenu des PNJ et son panier de besoins (5.2). */
export const npcClassSchema = z.strictObject({
  id,
  /** Sensibilité β à la qualité. */
  qualitySensitivity: z.number().min(0).max(1),
  /**
   * Revenu de la classe, en oboles par tick pour 1 000 habitants : plafond de sa dépense (5.2).
   * Réparti entre les biens du panier au prorata de leur dépense de référence (Q0 × prix de référence).
   */
  incomePerThousand: positiveInt,
  /**
   * Revenu public de la classe (#632) : ce que le robinet `faucet_npc_public_income` crédite chaque jour, à la
   * clôture, à la bourse des PNJ de sa cité, en points de base du revenu d'un jour de la classe (revenu par tick ×
   * ticks d'un jour, sur sa population). Plancher qui fait acheter une cité sans emploi ; levier de calibrage
   * (#283). Absent d'une version publiée avant lui : `DEFAULT_NPC_PUBLIC_INCOME_BPS` (`npcPublicIncomeBps`).
   */
  publicIncomeBps: z.number().int().min(0).max(10_000).optional(),
  basket: z
    .array(
      z.strictObject({
        goodId: id,
        need: z.enum(NEED_LEVELS),
        /** Q0 : quantité demandée par tick (de `clock.tickMinutes`) pour 1 000 habitants, au prix de référence. */
        quantityPerThousand: z.number().positive(),
      }),
    )
    .min(1),
});

/** Charis par unité offerte d'un bien, ou par obole : au plus un million, pour un gain en entiers sûrs. */
const charisRate = z.number().int().max(1_000_000);

/**
 * Un dieu du panthéon et sa Charis (docs/specs/07-dieux-faveur-evenements.md, 7.1 ; #265). Lu par les joueurs
 * (vue `public.temple_rules`) : n'y ranger aucun paramètre qui doive rester caché. Ajouter un dieu ne demande
 * aucun code. Les champs de la Charis sont absents des versions publiées avant elle : le dieu n'y accepte
 * aucune offrande, rien ne décline, et sa Charis de cité est nulle.
 */
export const godSchema = z.strictObject({
  id,
  /** Charis gagnée par obole offerte (puits `sink_offerings`). Nulle : le dieu n'accepte pas la monnaie. */
  charisPerObole: charisRate.min(0).default(0),
  /** Charis gagnée par unité offerte de chaque bien ; un bien absent n'est pas accepté. */
  charisPerUnit: z.record(id, charisRate.positive()).default({}),
  /** Déclin de la Charis de chaque maison à chaque clôture, arrondi vers zéro. Nul : elle ne décline pas. */
  dailyDecayBps: z.number().int().min(0).max(10_000).default(0),
  /**
   * Poids de la Charis de cité d'une cité dont il est le dieu protecteur : la Charis de ses citoyennes
   * envers lui, sommée, fois ce poids (10 000 = ×1), arrondie vers zéro.
   */
  cityCharisWeightBps: z.number().int().min(0).max(100_000).default(0),
});

/**
 * Une cité et son identité (docs/specs/06-cites-politique-communaute.md, 6.1).
 * Les champs d'identité sont lus par les joueurs (vue `public.city_identity`) : rien de caché.
 * Ils sont absents des versions publiées avant les quatre cités, qui restent lisibles : terroir ouvert à
 * toutes les recettes, port, aucun dieu protecteur, recette de départ commune (`cityTerroirAdmits`,
 * `cityHasPort`, `cityStartingRecipeId`). Toute version publiée depuis les porte explicitement.
 */
export const cityConfigSchema = z.strictObject({
  id,
  /** Population de PNJ par classe. */
  // Au plus 100 millions par classe : la limite de calcul exact de `nextPopulation` (packages/sim).
  population: z.record(id, z.number().int().nonnegative().max(100_000_000)),
  /**
   * Terroir : recettes de production primaire qu'un site de la cité peut lancer (4.2). Les ateliers sont
   * admis partout et n'y figurent pas. Absent : toutes les recettes sont admises.
   */
  terroir: z.array(id).max(100).optional(),
  /** La cité a-t-elle un port ? Absent : oui (`cityHasPort`), comme Kallistè dans les versions antérieures. */
  hasPort: z.boolean().optional(),
  /** Dieu protecteur, parmi `gods`. Absent : aucun. */
  patronGodId: id.optional(),
  /** Recette du premier site d'une maison fondée ici. Absente : `starting.siteRecipeId`. */
  startingRecipeId: id.optional(),
  /**
   * Multiplicateur de la part publique des classes dans cette cité (#657), en points de base (10 000 = ×1), de ×0
   * à ×2 : le levier qui vise le déficit d'une cité importatrice sans gonfler la masse des autres. Caché aux
   * joueurs : `city_identity` ne rend que les champs d'identité. Absent : `DEFAULT_CITY_PUBLIC_INCOME_BPS`
   * (`cityPublicIncomeBps`).
   */
  npcPublicIncomeBps: z.number().int().min(0).max(20_000).optional(),
});

/**
 * Multiplicateur d'une cité dont la version de configuration ne le donne pas (#657) : ×1, si bien qu'une version
 * publiée avant lui garde son revenu public (règle de #621).
 */
export const DEFAULT_CITY_PUBLIC_INCOME_BPS = 10_000;
/** Multiplicateur de la part publique d'une cité : le sien, sinon celui d'une version publiée avant le paramètre. */
export const cityPublicIncomeBps = (city: { npcPublicIncomeBps?: number | undefined }) =>
  city.npcPublicIncomeBps ?? DEFAULT_CITY_PUBLIC_INCOME_BPS;

/** Horloges du monde (docs/specs/03-boucles-progression.md). */
export const clockSchema = z.strictObject({
  /**
   * Durée du tick : un diviseur de l'heure (donc de la journée). Le tick de clôture est le premier qui
   * commence à la clôture ou après (`isDailyClose`) : dans un fuseau décalé d'une demi-heure ou d'un quart
   * d'heure, il peut commencer un peu après elle. Ne change pas d'une version à l'autre (#123).
   */
  tickMinutes: positiveInt
    .refine((minutes) => MINUTES_PER_DAY % minutes === 0, {
      message: 'must divide the 1440 minutes of a day',
    })
    // Les fuseaux à décalage d'une demi-heure existent : un tick doit toujours commencer une heure locale.
    .refine((minutes) => 60 % minutes === 0, { message: 'must divide the 60 minutes of an hour' }),
  dailyCloseHour: z.number().int().min(0).max(23),
  /** Identifiant IANA, par exemple `Europe/Paris`. */
  timezone: z.string().refine(isTimezone, { message: 'unknown IANA time zone' }),
  /**
   * Durée d'une saison, en jours de jeu : au plus une année. Sans borne, une durée au-delà des entiers de
   * la base ferait échouer pour tous les joueurs les vues de comptes, qui la lisent (`game.clock_rules()`).
   */
  seasonDays: positiveInt.max(366),
});

function duplicates(ids: string[]): string[] {
  return [...new Set(ids.filter((value, index) => ids.indexOf(value) !== index))];
}

/** Paramètres de marché (docs/specs/05-economie.md, 5.2). */
export const marketSchema = z.strictObject({
  /**
   * Prix de réserve des PNJ : au-delà de ce multiple du prix de référence d'un bien, ils n'achètent pas.
   * Sans lui, un vendeur seul capterait tout le budget d'un bien avec une unité vendue à prix démesuré.
   */
  npcMaxPriceFactor: z.number().min(1).max(100),
  /**
   * Borne du budget non dépensé des PNJ reporté d'un tick au suivant (#675), en unités du bien au prix de réserve.
   * Au moins deux : à une seule, un budget de tick qui ne paie pas une unité perd la demande arrivée avant lui.
   * Absent d'une version publiée avant lui : aucun report, comme avant (`npcBudgetCarryUnits`).
   */
  npcBudgetCarryUnits: z.number().int().min(2).max(100).optional(),
});

/** Borne du report de budget des PNJ, en unités au prix de réserve : celle de la version, sinon aucun report (#675). */
export const npcBudgetCarryUnits = (market: { npcBudgetCarryUnits?: number | undefined }) =>
  market.npcBudgetCarryUnits ?? 0;

/** Dotation d'une maison à sa fondation (docs/specs/03-boucles-progression.md). */
export const startingSchema = z.strictObject({
  /** Monnaie versée par le robinet `faucet_starting_grant`, en oboles. */
  grantOboles: positiveInt,
  /** Recette du premier site reçu : une production primaire, exploitable sans rien acheter. */
  siteRecipeId: id,
});

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Valeurs lues pour les versions publiées avant l'entretien des sites : elles ne prélevaient rien.
 * FIGÉES, pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_UPKEEP = deepFreeze({
  coefficientBps: 10_000,
  dailyOboles: { field: 0, orchard: 0, pasture: 0, forest: 0, quarry: 0, fishery: 0, workshop: 0 },
});

/**
 * Coefficient d'entretien global, en points de base (10 000 = ×1), de ×0 à ×10 : l'un des trois leviers
 * d'inflation, qui se règle sans retoucher chaque type de site. Partagé avec le client (`site_rules`).
 */
export const upkeepCoefficientBpsSchema = z.number().int().min(0).max(100_000);
/** Entretien de base par jour de jeu, en oboles. Nul : pas d'entretien. Partagé avec le client. */
export const upkeepDailyObolesSchema = z.number().int().min(0).max(1_000_000_000);

/**
 * Entretien quotidien des sites, prélevé à la clôture et détruit (puits `sink_upkeep`, 5.5).
 * Dû par site : ⌈dailyOboles[type] × coefficientBps ÷ 10 000⌉.
 */
export const upkeepSchema = z.strictObject({
  coefficientBps: upkeepCoefficientBpsSchema,
  /** Pour chaque type de site. */
  dailyOboles: z.record(z.enum(SITE_TYPES), upkeepDailyObolesSchema),
});

/**
 * Valeurs lues pour les versions publiées avant que la section `sites` n'existe. FIGÉES : les changer
 * changerait après coup le prix d'une version immuable, et le rejeu d'un tick avec sa version
 * enregistrée divergerait. Un rééquilibrage passe par une nouvelle version de configuration, jamais
 * par cette constante.
 */
export const DEFAULT_SITES = deepFreeze({
  limitByHeadquartersLevel: [4],
  acquisitionCostOboles: {
    field: 600,
    orchard: 900,
    pasture: 700,
    forest: 700,
    quarry: 1200,
    fishery: 800,
    workshop: 1000,
  },
  upkeep: DEFAULT_UPKEEP,
});

/**
 * Sites d'une maison (docs/specs/04-systemes-gestion.md, 4.1 et 4.2).
 * Lue par les joueurs (vue `public.site_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const sitesSchema = z.strictObject({
  /**
   * Nombre de sites qu'une maison peut exploiter, par niveau de siège (le premier d'abord). Seul le
   * premier niveau existe pour l'instant : toute maison est au niveau 1.
   */
  limitByHeadquartersLevel: z.array(positiveInt).min(1).max(10),
  /** Prix d'acquisition d'un site, en oboles, pour chaque type de site. La monnaie est détruite. */
  acquisitionCostOboles: z.record(z.enum(SITE_TYPES), positiveInt),
  /** Absent d'une version publiée avant l'entretien : elle reste lisible, sans entretien. */
  upkeep: upkeepSchema.default(DEFAULT_UPKEEP),
});

/**
 * Une classe de navire (docs/specs/04-systemes-gestion.md, 4.6). Lue par les joueurs (vue
 * `public.ship_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const shipClassSchema = z.strictObject({
  id,
  /** Cargaison au plus, en unités de biens, tous biens confondus. */
  capacityUnits: z.number().int().positive().max(1_000_000),
  /** Vitesse en points de base : 10 000 tient la durée de référence d'une route, 20 000 la divise par deux. */
  speedBps: z.number().int().min(1_000).max(100_000),
  /** Prix d'achat d'un navire neuf, en oboles. La monnaie est détruite (puits `sink_ship_purchase`). */
  purchaseCostOboles: z.number().int().positive().max(1_000_000_000),
  /** Entretien par jour de jeu, en oboles, prélevé à la clôture (#252). Nul : pas d'entretien. */
  dailyUpkeepOboles: upkeepDailyObolesSchema,
});

/** Montant d'un tarif du transport, en oboles. Nul : rien à payer. */
const shipFeeObolesSchema = z.number().int().min(0).max(1_000_000_000);

/**
 * Une route maritime entre deux cités (4.6, #252), parcourue dans les deux sens. Lue par les joueurs
 * (vue `public.ship_rules`).
 */
/** Un risque de perte en mer, en points de base, de 0 (jamais) à 10 000 (toujours). Partagé avec le client. */
export const shipLossRiskBpsSchema = z.number().int().min(0).max(10_000);

export const shipRouteSchema = z.strictObject({
  /** Les deux cités reliées (identifiants de `cities`), chacune avec un port. */
  cities: z.tuple([id, id]),
  /** Durée du trajet pour un navire de vitesse 10 000, en heures réelles. */
  hours: z.number().int().min(2).max(20),
  /**
   * Provisions d'un voyage par classe de navire (identifiant de `ships.classes`), en oboles, détruites au
   * départ (puits `sink_voyage_provisions`). Vide : aucune provision ; sinon, chaque classe a les siennes.
   */
  provisionsOboles: z.record(id, shipFeeObolesSchema),
  /**
   * Risque de perte de la cargaison d'un voyage sur la route (4.6, #730), en points de base : 10 000, toujours
   * perdue. Fixé au départ et gardé avec le voyage, tiré à l'arrivée. Absent (version publiée avant les pertes,
   * ou configuration initiale) : nul, aucun voyage ne perd rien. Facultatif sans valeur par défaut : une version
   * relue reste égale à celle écrite ; `routeLossRiskBps` lit la valeur nulle.
   */
  lossRiskBps: shipLossRiskBpsSchema.optional(),
  /**
   * Majoration du risque d'un voyage qui part pendant une tempête de la route (7.4, #730), en points de base,
   * ajoutée au risque de la route ; la somme est bornée à 10 000. Absente : nulle (`routeStormLossRiskBps`).
   */
  stormLossRiskBps: shipLossRiskBpsSchema.optional(),
});

/**
 * Valeurs lues pour les versions publiées avant le droit de port : rien à payer. FIGÉES, pour la même
 * raison que `DEFAULT_SITES`.
 */
export const DEFAULT_PORT_DUES = deepFreeze({
  byClassOboles: {} as Record<string, number>,
  // Inerte : sans forfait, le droit est nul et sa part détruite aussi. 10 000 plutôt que 0 pour qu'une
  // version qui ajouterait un forfait sans dire la part ne verse rien au trésor par défaut.
  burnShareBps: 10_000,
  cityCoefficientBps: {} as Record<string, number>,
});

/**
 * Droit de port de la cité d'arrivée (5.6, #252) : un forfait par classe de navire, payé au départ,
 * modulé par la cité. Dû : ⌈byClassOboles[classe] × coefficient de la cité ÷ 10 000⌉ ; sa part détruite
 * (puits `sink_port_dues`) est ⌈dû × burnShareBps ÷ 10 000⌉, le reste va au trésor de la cité d'arrivée.
 * Lue par les joueurs (vue `public.ship_rules`).
 */
export const portDuesSchema = z.strictObject({
  /** Forfait par classe de navire, en oboles. Vide : aucun droit ; sinon, chaque classe a le sien. */
  byClassOboles: z.record(id, shipFeeObolesSchema),
  /** Part du droit détruite, en points de base ; le reste va au trésor de la cité d'arrivée. */
  burnShareBps: z.number().int().min(0).max(10_000),
  /** Coefficient de chaque cité (identifiant de `cities`), en points de base, de ×0 à ×10. Absent : ×1. */
  cityCoefficientBps: z.record(id, z.number().int().min(0).max(100_000)),
});

/**
 * Valeurs lues pour les versions publiées avant le transport : aucune classe, donc aucun navire à
 * acheter, ni route, ni droit de port. FIGÉES, pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_SHIPS = deepFreeze({
  classes: [] as z.infer<typeof shipClassSchema>[],
  routes: [] as z.infer<typeof shipRouteSchema>[],
  portDues: DEFAULT_PORT_DUES,
});

/**
 * Navires des maisons et leurs voyages (4.6). Lue par les joueurs (vue `public.ship_rules`) : n'y ranger
 * aucun paramètre qui doive rester caché.
 */
export const shipsSchema = z.strictObject({
  classes: z.array(shipClassSchema).max(20),
  /** Absentes d'une version publiée avant les voyages : aucune route, aucun départ possible. */
  routes: z.array(shipRouteSchema).max(100).default([]),
  /** Absent d'une version publiée avant les voyages : aucun droit de port. */
  portDues: portDuesSchema.default(DEFAULT_PORT_DUES),
});

/**
 * Valeurs lues pour les versions publiées avant le personnel : aucun salaire, dans aucune cité. FIGÉES,
 * pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_STAFF = deepFreeze({ dailyWageOboles: {} as Record<string, number> });

/** Salaire quotidien de base d'un travailleur, en oboles. Nul : pas de salaire. Partagé avec le client. */
export const staffDailyWageObolesSchema = z.number().int().min(0).max(1_000_000_000);

/**
 * Personnel des sites (docs/specs/04-systemes-gestion.md, 4.4) : chaque site emploie les travailleurs
 * de sa recette (`workers`), que sa maison paie à la clôture avec son entretien, à la bourse des PNJ de la
 * cité du site (#632, 5.5). Lue par les joueurs (vue `public.site_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const staffSchema = z.strictObject({
  /**
   * Salaire du jour d'un travailleur, par cité (identifiant de `cities`). Vide : aucun salaire nulle
   * part, comme une version publiée avant le personnel ; sinon, chaque cité a le sien.
   */
  dailyWageOboles: z.record(id, staffDailyWageObolesSchema),
});

/**
 * Courbe d'un prix du marché du travail (#258) : un multiplicateur en points de base (10 000 : ×1), de
 * `minBps` à `maxBps` (de ×0 à ×10), qui monte de `slopeBps` quand le taux mesuré passe de 0 à 100 %.
 * Calcul : `curveBps` (packages/sim).
 */
const laborCurveShape = {
  minBps: z.number().int().min(0).max(100_000),
  maxBps: z.number().int().min(0).max(100_000),
  slopeBps: z.number().int().min(0).max(100_000),
};
const laborCurveOrdered: [
  (curve: { minBps: number; maxBps: number }) => boolean,
  { message: string; path: string[] },
] = [
  (curve) => curve.minBps <= curve.maxBps,
  { message: 'minBps must not exceed maxBps', path: ['maxBps'] },
];
export const laborCurveSchema = z.strictObject(laborCurveShape).refine(...laborCurveOrdered);

/**
 * Valeurs lues pour les versions publiées avant le marché du travail : offre sans limite, salaire de base
 * de la cité, aucun hébergement à payer. FIGÉES, pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_LABOR = deepFreeze({
  workingShareBps: {} as Record<string, number>,
  wage: { minBps: 10_000, maxBps: 10_000, slopeBps: 0 },
  lodging: { baseOboles: 0, minBps: 10_000, maxBps: 10_000, slopeBps: 0 },
});

/**
 * Marché du travail et logement des travailleurs (docs/specs/04-systemes-gestion.md, 4.4 et 4.5 ; #258).
 * Chaque clôture fixe, par cité, le salaire du jour (salaire de base de `staff` × courbe du salaire au
 * taux d'emploi) et le prix d'une nuit d'hébergement chez les PNJ pour un travailleur sans logement (prix
 * de base × courbe de l'hébergement à la pénurie de logements), versé à la bourse des PNJ de la cité (#632).
 */
export const laborSchema = z.strictObject({
  /**
   * Classes de PNJ travailleuses (identifiants de `npcClasses`) et part de leur population qui travaille,
   * en points de base. Vide : l'offre de travail est sans limite et le taux d'emploi nul.
   */
  workingShareBps: z.record(id, z.number().int().min(0).max(10_000)),
  wage: laborCurveSchema,
  lodging: z
    .strictObject({
      /** Prix de base d'une nuit d'hébergement, en oboles, par travailleur sans logement. Nul : rien. */
      baseOboles: staffDailyWageObolesSchema,
      ...laborCurveShape,
    })
    .refine(...laborCurveOrdered),
});

/**
 * Une taille de logement (docs/specs/04-systemes-gestion.md, 4.5 ; #256). Lue par les joueurs (vue
 * `public.property_rules`) : n'y ranger aucun paramètre qui doive rester caché. L'état d'un bien va de 0 à
 * 10 000 (neuf) : vétusté et seuil se comptent dans cette unité.
 */
export const propertySizeSchema = z.strictObject({
  id,
  /** Prix d'achat à la cité, en oboles. La monnaie est détruite (puits `sink_property_purchase`). */
  purchasePriceOboles: z.number().int().positive().max(1_000_000_000),
  /** Capacité en logements d'un bien en état de loger. */
  housingUnits: z.number().int().positive().max(1_000_000),
  /** Entretien par jour de jeu, en oboles, prélevé à la clôture (puits `sink_property_upkeep`). Nul : rien. */
  dailyUpkeepOboles: upkeepDailyObolesSchema,
  /** Vétusté : points d'état perdus à chaque clôture. Nul : le bien ne s'use pas. */
  dailyWear: z.number().int().min(0).max(10_000),
  /** État sous lequel le bien ne loge plus personne, jusqu'à sa rénovation. */
  minHabitableCondition: z.number().int().min(0).max(10_000),
  /**
   * Rénovation, qui rend au bien son état neuf : des oboles détruites (puits `sink_property_works`), et
   * des biens consommés dans le stock libre de la maison dans la cité du bien. Le prix en oboles est
   * positif : la base reconnaît une rénovation à son écriture du grand livre.
   */
  renovation: z.strictObject({
    oboles: z.number().int().positive().max(1_000_000_000),
    goods: z.array(stack).max(20),
  }),
});

/**
 * Valeurs lues pour les versions publiées avant l'immobilier : aucune taille, aucun bien dans aucune
 * cité. FIGÉES, pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_PROPERTIES = deepFreeze({
  sizes: [] as z.infer<typeof propertySizeSchema>[],
  countsByCity: {} as Record<string, Record<string, number>>,
});

/**
 * Immobilier urbain (4.5) : le parc de logements de chaque cité, que le moteur crée, détenu d'abord par
 * la cité. Lue par les joueurs (vue `public.property_rules`).
 */
export const propertiesSchema = z.strictObject({
  sizes: z.array(propertySizeSchema).max(10),
  /**
   * Nombre de biens de chaque taille, par cité (identifiants de `cities` et de `sizes`). Le parc d'une
   * cité grandit jusqu'à ce nombre ; le baisser ne retire aucun bien.
   */
  countsByCity: z.record(id, z.record(id, z.number().int().min(0).max(10_000))),
});

/**
 * Valeurs lues pour les versions publiées avant la taxe de marché : elles ne taxaient rien. FIGÉES, pour
 * la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_MARKET_TAX = deepFreeze({ rateBps: 0, burnShareBps: 10_000 });

/**
 * Taxe de marché, prélevée sur le vendeur à chaque échange de l'agora (5.3, 5.6). Taux en points de
 * base (1 pour 10 000) : le calcul reste en entiers, arrondi compris.
 * Lue par les joueurs (vue `public.market_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const marketTaxSchema = z.strictObject({
  /** Taux de la taxe sur le montant brut d'un échange. Borné : au-delà, vendre ne paie plus. */
  rateBps: z.number().int().min(0).max(5000),
  /** Part de la taxe détruite (puits `sink_market_tax`) ; le reste va au trésor de la cité. */
  burnShareBps: z.number().int().min(0).max(10_000),
});

/**
 * Valeurs lues pour les versions publiées avant la dynamique de population : la population des PNJ ne
 * bouge pas (aucune croissance, aucune émigration, bornes égales à la population initiale). FIGÉES, pour
 * la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_POPULATION_DYNAMICS = deepFreeze({
  vitalCoverageThresholdBps: 10_000,
  growthBps: 0,
  emigrationBps: 0,
  minShareBps: 10_000,
  maxShareBps: 10_000,
});

/**
 * Dynamique de la population des PNJ (5.2), appliquée à chaque clôture quotidienne par classe et par
 * cité, d'après la couverture du jour de ses besoins vitaux (quantités servies sur quantités demandées).
 * Points de base : au-dessus du seuil la classe croît, jusqu'à `growthBps` par jour à 100 % ; en
 * dessous elle émigre, jusqu'à `emigrationBps` par jour à 0 %. Bornes en points de base de la
 * population initiale de la cité. Calcul : `nextPopulation` (packages/sim).
 */
export const populationDynamicsSchema = z.strictObject({
  vitalCoverageThresholdBps: z.number().int().min(1).max(10_000),
  growthBps: z.number().int().min(0).max(1_000),
  emigrationBps: z.number().int().min(0).max(1_000),
  minShareBps: z.number().int().min(0).max(10_000),
  maxShareBps: z.number().int().min(10_000).max(100_000),
});

/**
 * Valeurs lues pour les versions publiées avant l'historique des prix. FIGÉES, pour la même raison que
 * `DEFAULT_SITES`.
 */
export const DEFAULT_PRICE_HISTORY = deepFreeze({ candleMinutes: 60, referenceWindowHours: 24 });

/**
 * Historique des prix de l'agora (5.3).
 * Lue par les joueurs (vue `public.market_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const priceHistorySchema = z.strictObject({
  /**
   * Durée d'un chandelier, en minutes, d'une minute à une journée. La changer ouvre une nouvelle série,
   * recalculée depuis les échanges ; l'ancienne reste telle quelle.
   */
  candleMinutes: z.number().int().min(1).max(1440),
  /**
   * Fenêtre du prix de référence observé, en heures : le prix moyen des échanges de cette durée, d'une
   * heure à trente jours. Absente d'une version publiée avant lui : 24 heures.
   */
  referenceWindowHours: z
    .number()
    .int()
    .min(1)
    .max(720)
    .default(DEFAULT_PRICE_HISTORY.referenceWindowHours),
});

/**
 * Valeurs lues pour les versions publiées avant l'indice des prix : la cible de la règle de conception
 * (5.5) et un panier vide, donc un indice inconnu. FIGÉES, pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_PRICE_INDEX = deepFreeze({
  windowDays: 30,
  inflationTargetBps: { min: 0, max: 300 },
  basket: [] as { goodId: string; quantity: number }[],
});

/** Indice des prix et mesure de l'inflation du tableau de bord économique (5.5). Rien du jeu ne s'y règle. */
export const priceIndexSchema = z.strictObject({
  /** Fenêtre de mesure, en jours : l'inflation compare cette fenêtre à celle qui la précède. */
  windowDays: z.number().int().min(1).max(365),
  /** Cible d'inflation sur la fenêtre, en points de base, bornes comprises ; hors d'elle, alerte. */
  inflationTargetBps: z
    .strictObject({
      min: z.number().int().min(-10_000).max(10_000),
      max: z.number().int().min(-10_000).max(10_000),
    })
    .refine((target) => target.min <= target.max, { message: 'min must not exceed max' }),
  /** Panier de référence : quantités fixes de biens, dont l'indice suit le coût. Vide : indice inconnu. */
  basket: z.array(stack).max(100),
});

/**
 * Valeurs lues pour les versions publiées avant la rétention de la télémétrie : 90 jours. FIGÉES, pour la
 * même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_TELEMETRY = deepFreeze({ retentionDays: 90 });

/**
 * Télémétrie du moteur (15.1) : passages de tick et de clôture que la Vigie lit. Au-delà de la rétention,
 * le moteur les supprime. Au moins deux jours : la Vigie compte les échecs des dernières 24 heures.
 */
export const telemetrySchema = z.strictObject({
  retentionDays: z.number().int().min(2).max(3650),
});

/**
 * Valeurs lues pour les versions publiées avant la discussion : 500 caractères, 30 jours de conservation,
 * 10 messages par minute. FIGÉES, pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_CHAT = deepFreeze({
  maxMessageLength: 500,
  retentionDays: 30,
  rateLimit: { messages: 10, windowSeconds: 60 },
});

/**
 * Discussion (docs/specs/06-cites-politique-communaute.md, 6.6) : canal de la cité et conversations
 * privées. La longueur a un plafond technique de 2 000 caractères, que la base vérifie aussi
 * (`messages_body_length`) : une commande tient alors dans la taille maximale d'un corps de requête.
 */
export const chatSchema = z.strictObject({
  /** Longueur maximale d'un message, en caractères (points de code Unicode). */
  maxMessageLength: z.number().int().min(1).max(2_000),
  /** Au-delà, le moteur supprime le message (conservation limitée, 18). Au moins un jour. */
  retentionDays: z.number().int().min(1).max(3650),
  /** Débit propre à la discussion : messages d'une maison, tous canaux confondus, par fenêtre glissante. */
  rateLimit: z.strictObject({
    messages: z.number().int().min(1).max(1_000),
    windowSeconds: z.number().int().min(1).max(86_400),
  }),
});

/**
 * Durées proposées aux modérateurs, en heures, lues pour les versions publiées avant les commandes
 * d'administration (#276) : un avertissement affiché une semaine ; un silence d'une heure, d'un jour ou de trois ;
 * une suspension d'un jour, d'une semaine ou de trente jours. FIGÉES, pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_SANCTION_HOURS = deepFreeze({
  warning: [168],
  silence: [1, 24, 72],
  suspension: [24, 168, 720],
});

/**
 * Valeurs lues pour les versions publiées avant la modération (#275) : cinq motifs de signalement, aucun terme
 * interdit, des appels de 1 000 caractères au plus, les durées de `DEFAULT_SANCTION_HOURS`. FIGÉES, pour la même
 * raison que `DEFAULT_SITES`.
 */
export const DEFAULT_MODERATION = deepFreeze({
  reportReasons: ['spam', 'harassment', 'hate', 'cheating', 'other'],
  bannedTerms: [] as string[],
  maxAppealLength: 1_000,
  staleReportHours: 24,
  sanctionHours: DEFAULT_SANCTION_HOURS,
  triageSummaryMaxLength: 200,
});

/** Durées proposées pour une sorte de sanction : de une à dix, distinctes, d'une heure à un an. */
const sanctionHoursSchema = z
  .array(z.number().int().min(1).max(8_760))
  .min(1)
  .max(10)
  .refine((hours) => new Set(hours).size === hours.length, { message: 'duplicate duration' });

/**
 * Modération (docs/specs/15-back-office-olympe.md, 15.1 ; 18, contenus ; #275). Les motifs se lisent par les
 * joueurs (vue `public.moderation_rules`), jamais les termes interdits, qui ne servent qu'à l'API. Un appel a
 * un plafond technique de 2 000 caractères, que la base vérifie aussi (`sanctions_appeal_length`).
 */
export const moderationSchema = z
  .strictObject({
    /** Motifs qu'un joueur choisit en signalant un message ; leurs libellés sont dans les traductions. */
    reportReasons: z.array(id).min(1).max(20),
    /**
     * Termes refusés dans un message, comparés sans casse ni accent, mot à mot (`findBannedTerm`). Un terme
     * doit contenir au moins une lettre ou un chiffre : sans eux, il ne refuserait rien.
     */
    bannedTerms: z.array(z.string().min(1).max(100)).max(5_000),
    /** Longueur maximale d'un appel, en caractères (points de code Unicode). */
    maxAppealLength: z.number().int().min(1).max(2_000),
    /**
     * Seuil d'alerte de la Vigie (15.5), en heures : un signalement encore ouvert au-delà passe en alerte.
     * Absent d'une version publiée avant lui : 24 heures, le seuil de la spécification.
     */
    staleReportHours: z.number().int().min(1).max(720).default(DEFAULT_MODERATION.staleReportHours),
    /**
     * Durées, en heures, entre lesquelles un modérateur choisit (`admin.sanction`) ; une exclusion n'en a pas.
     * Absentes d'une version publiée avant les commandes d'administration : `DEFAULT_SANCTION_HOURS`.
     */
    sanctionHours: z
      .strictObject({
        warning: sanctionHoursSchema,
        silence: sanctionHoursSchema,
        suspension: sanctionHoursSchema,
      })
      .default(DEFAULT_SANCTION_HOURS),
    /**
     * Longueur maximale, en caractères, du résumé d'un message signalé par le pré-tri de l'IA (usage
     * `moderation_triage`, 8.1, 15.1 ; #763) : une phrase. Absente d'une version publiée avant lui : 200.
     */
    triageSummaryMaxLength: z
      .number()
      .int()
      .min(20)
      .max(500)
      .default(DEFAULT_MODERATION.triageSummaryMaxLength),
  })
  .superRefine((moderation, ctx) => {
    for (const duplicate of duplicates(moderation.reportReasons))
      ctx.addIssue({
        code: 'custom',
        path: ['reportReasons'],
        message: `duplicate reason "${duplicate}"`,
      });
    moderation.bannedTerms.forEach((term, index) => {
      if (filterForm(term) === '')
        ctx.addIssue({
          code: 'custom',
          path: ['bannedTerms', index],
          message: 'no letter or digit',
        });
    });
  });

/**
 * Valeurs lues pour les versions publiées avant la chronique (#271) : trois biens détaillés, une minute
 * d'attente après la clôture, 2 000 caractères par texte réécrit. FIGÉES, pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_CHRONICLE = deepFreeze({
  maxGoods: 3,
  settleSeconds: 60,
  maxTextLength: 2_000,
});

/**
 * Chronique des cités (docs/specs/06-cites-politique-communaute.md, 6.6 ; 08-ia.md, 8.1) : une par cité et par
 * clôture, composée par gabarits à partir des faits du jour, puis réécrite par la passerelle IA (usage
 * `chronicle`). La longueur a un plafond technique de 4 000 caractères, que la base vérifie aussi.
 */
export const chronicleSchema = z.strictObject({
  /** Biens dont les échanges sont détaillés, les plus échangés d'abord ; les suivants sont seulement comptés. */
  maxGoods: z.number().int().min(0).max(20),
  /**
   * Attente après la clôture avant d'écrire sa chronique, en secondes : une commande commencée juste avant la
   * clôture a le temps d'être validée et d'entrer dans les faits. Au plus une heure.
   */
  settleSeconds: z.number().int().min(0).max(3_600),
  /** Longueur maximale de chaque texte réécrit (`fr`, `en`), en caractères ; au-delà, le repli est gardé. */
  maxTextLength: z.number().int().min(200).max(4_000),
});

/**
 * Magistrature de l'archonte (docs/specs/06-cites-politique-communaute.md, 6.2), en jours de jeu.
 * Une élection ouvre le dépôt des candidatures `candidacyDays + votingDays` jours avant le début du
 * mandat qu'elle pourvoit, puis le vote `votingDays` jours avant ; elle est dépouillée à la clôture qui
 * ouvre ce mandat. Lue par les joueurs (vue `public.politics_rules`) : rien de caché.
 */
export const archonSchema = z
  .strictObject({
    /** Durée du mandat : une année de jeu (4 semaines) au départ. */
    termDays: z.number().int().min(1).max(366),
    candidacyDays: z.number().int().min(1).max(366),
    votingDays: z.number().int().min(1).max(366),
    /** Mandats consécutifs au plus : une maison qui les a tenus ne se présente pas au suivant. */
    maxConsecutiveTerms: z.number().int().min(1).max(100),
  })
  // L'élection suivante s'ouvre pendant le mandat en cours : jamais avant son début.
  .refine((archon) => archon.candidacyDays + archon.votingDays <= archon.termDays, {
    message: 'the candidacy and voting periods must fit in a term',
    path: ['termDays'],
  });

/**
 * Citoyenneté et magistratures (3, progression ; 6.2). Lue par les joueurs (vue `public.politics_rules`) :
 * n'y ranger aucun paramètre qui doive rester caché.
 */
export const politicsSchema = z.strictObject({
  /**
   * Jours de jeu comme métèque : une maison fondée un jour de jeu devient citoyenne à la clôture qui ouvre
   * le jour situé autant de jours plus loin (3 : métèque les jours 1 à 3, citoyenne au quatrième).
   */
  meticDays: z.number().int().min(1).max(366),
  archon: archonSchema,
});

/**
 * Usages de l'IA (8.1) : oracles de la Pythie, chronique des cités, consignes d'intendant (phase 2), pré-tri des
 * signalements (phase 3, #763).
 */
export const AI_USAGES = ['oracle', 'chronicle', 'steward', 'moderation_triage'] as const;
export type AiUsage = (typeof AI_USAGES)[number];

/**
 * Réglage d'un usage de l'IA (8.4, 8.5). Les prix sont en millionièmes d'euro par millier de jetons, en
 * entiers ; la part du plafond mensuel en points de base du budget de tous les usages.
 */
export const aiUsageSchema = z.strictObject({
  /** Interrupteur de l'usage : coupé, la passerelle rend le repli sans appeler le fournisseur. */
  enabled: z.boolean(),
  /** Modèle demandé au fournisseur (petit modèle rapide par défaut, 8.4). */
  model: z.string().min(1).max(100),
  /** Délai au-delà duquel l'appel est abandonné au profit du repli. */
  timeoutMs: z.number().int().min(100).max(120_000),
  /**
   * Jetons de sortie au plus par appel : borne le coût d'un appel, que la passerelle réserve sur le
   * plafond avant de partir.
   */
  maxOutputTokens: z.number().int().min(1).max(100_000),
  /** Part du plafond mensuel de tous les usages réservée à celui-ci. */
  capShareBps: z.number().int().min(0).max(10_000),
  inputMicroEurosPerThousandTokens: z.number().int().min(0).max(1_000_000),
  outputMicroEurosPerThousandTokens: z.number().int().min(0).max(1_000_000),
});

const disabledUsage = {
  enabled: false,
  model: 'none',
  timeoutMs: 10_000,
  maxOutputTokens: 1,
  capShareBps: 0,
  inputMicroEurosPerThousandTokens: 0,
  outputMicroEurosPerThousandTokens: 0,
};

/**
 * Valeurs lues pour les versions publiées avant la passerelle IA : tous les usages coupés, budget nul.
 * FIGÉES, pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_AI = deepFreeze({
  budgetMicroEurosPerActivePlayerMonth: 0,
  expectedActivePlayers: 0,
  stewardDailyQuotaPerHouse: 0,
  usages: {
    oracle: disabledUsage,
    chronicle: disabledUsage,
    steward: disabledUsage,
    moderation_triage: disabledUsage,
  },
});

/**
 * Passerelle IA (8.4, 8.5). Le plafond mensuel de tous les usages vaut le budget par joueur actif et par
 * mois (au plus 0,10 €, cible de 8.5) multiplié par le nombre de joueurs actifs attendu ; chaque usage en
 * reçoit sa part, et la somme des parts ne dépasse pas le tout.
 */
export const aiSchema = z
  .strictObject({
    budgetMicroEurosPerActivePlayerMonth: z.number().int().min(0).max(100_000),
    expectedActivePlayers: z.number().int().min(0).max(1_000_000),
    /** Consignes d'intendant en langage naturel par maison et par jour de jeu (8.4) ; 0 : aucune. */
    stewardDailyQuotaPerHouse: z.number().int().min(0).max(1_000),
    usages: z.strictObject({
      oracle: aiUsageSchema,
      chronicle: aiUsageSchema,
      steward: aiUsageSchema,
      /** Absent d'une version publiée avant le pré-tri (#763) : coupé, comme `DEFAULT_AI`. */
      moderation_triage: aiUsageSchema.default(disabledUsage),
    }),
  })
  .refine(
    (ai) => AI_USAGES.reduce((sum, usage) => sum + ai.usages[usage].capShareBps, 0) <= 10_000,
    { message: 'the usages may not share more than the whole budget', path: ['usages'] },
  )
  // Un usage ouvert à sortie gratuite n'aurait jamais de coût estimé, donc jamais de plafond atteint.
  .superRefine((ai, ctx) => {
    for (const usage of AI_USAGES)
      if (ai.usages[usage].enabled && ai.usages[usage].outputMicroEurosPerThousandTokens === 0)
        ctx.addIssue({
          code: 'custom',
          path: ['usages', usage, 'outputMicroEurosPerThousandTokens'],
          message: 'an enabled usage must have a price, or its cap would never be reached',
        });
  });

/** Plafond mensuel d'un usage, en millionièmes d'euro, arrondi à l'unité inférieure. */
export function aiMonthlyCapMicroEuros(ai: z.infer<typeof aiSchema>, usage: AiUsage): number {
  return Math.floor(
    (ai.budgetMicroEurosPerActivePlayerMonth *
      ai.expectedActivePlayers *
      ai.usages[usage].capShareBps) /
      10_000,
  );
}

/** Un atelier transforme des intrants : il est admis dans toute cité, hors terroir (4.2, 4.3). */
export function isWorkshop(recipe: { siteType: string }): boolean {
  return recipe.siteType === 'workshop';
}

/**
 * Un site de la cité peut-il lancer cette recette (4.2) ? Oui pour un atelier, pour une cité sans
 * terroir (version antérieure aux quatre cités) ou inconnue de la configuration (`undefined`), et pour
 * une recette de son terroir.
 */
export function cityTerroirAdmits(
  city: { terroir?: readonly string[] | undefined } | undefined,
  recipe: { id: string; siteType: string },
): boolean {
  return isWorkshop(recipe) || city?.terroir === undefined || city.terroir.includes(recipe.id);
}

/**
 * La cité a-t-elle un port ? Une version publiée avant les quatre cités ne le dit pas : Kallistè, sa seule
 * cité, en a un. Une cité inconnue de la configuration n'en a pas.
 */
export function cityHasPort(city: { hasPort?: boolean | undefined } | undefined): boolean {
  return city ? (city.hasPort ?? true) : false;
}

/**
 * Salaire du jour d'un travailleur dans la cité (4.4), en oboles : nul pour une version publiée avant le
 * personnel et pour une cité inconnue de la configuration, qui ne paient aucun salaire.
 */
export function cityDailyWageOboles(config: Pick<GameConfig, 'staff'>, cityId: string): number {
  const wages = config.staff.dailyWageOboles;
  return Object.hasOwn(wages, cityId) ? (wages[cityId] ?? 0) : 0;
}

/** Route entre deux cités (identifiants de `cities`), dans un sens ou dans l'autre ; `undefined` sans route. */
export function shipRoute(
  config: Pick<GameConfig, 'ships'>,
  fromCityId: string,
  toCityId: string,
): ShipRoute | undefined {
  return config.ships.routes.find(
    ({ cities: [a, b] }) =>
      (a === fromCityId && b === toCityId) || (a === toCityId && b === fromCityId),
  );
}

/** Une table de tarifs par identifiant : vide, rien à payer ; un identifiant absent ne paie rien non plus. */
const feeOf = (fees: Record<string, number>, key: string) =>
  Object.hasOwn(fees, key) ? (fees[key] ?? 0) : 0;

/** Risque de perte de la cargaison sur la route, en points de base (#730) : nul s'il est absent. */
export const routeLossRiskBps = (route: Pick<ShipRoute, 'lossRiskBps'>): number =>
  route.lossRiskBps ?? 0;

/** Majoration de ce risque pendant une tempête de la route, en points de base (#730) : nulle si absente. */
export const routeStormLossRiskBps = (route: Pick<ShipRoute, 'stormLossRiskBps'>): number =>
  route.stormLossRiskBps ?? 0;

/** Provisions d'un voyage sur la route pour la classe de navire, en oboles (nulles sans tarif). */
export function routeProvisionsOboles(route: ShipRoute, classId: string): number {
  return feeOf(route.provisionsOboles, classId);
}

/** Forfait du droit de port de la classe, en oboles, avant le coefficient de la cité (nul sans tarif). */
export function portDuesBaseOboles(config: Pick<GameConfig, 'ships'>, classId: string): number {
  return feeOf(config.ships.portDues.byClassOboles, classId);
}

/** Coefficient du droit de port de la cité, en points de base : 10 000 (×1) quand elle n'en a pas. */
export function cityPortDuesCoefficientBps(
  config: Pick<GameConfig, 'ships'>,
  cityId: string,
): number {
  const coefficients = config.ships.portDues.cityCoefficientBps;
  return Object.hasOwn(coefficients, cityId) ? (coefficients[cityId] ?? 10_000) : 10_000;
}

/** Recette du premier site d'une maison fondée dans la cité : la sienne, sinon la commune. */
export function cityStartingRecipeId(
  config: Pick<GameConfig, 'cities' | 'starting'>,
  cityId: string,
): string {
  const city = config.cities.find((candidate) => candidate.id === cityId);
  return city?.startingRecipeId ?? config.starting.siteRecipeId;
}

export const gameConfigSchema = z
  .strictObject({
    clock: clockSchema,
    market: marketSchema,
    starting: startingSchema,
    /**
     * Absent des versions publiées avant l'acquisition de sites : elles restent lisibles, avec les
     * valeurs de départ ci-dessus. Toute version publiée depuis le porte explicitement.
     */
    sites: sitesSchema.default(DEFAULT_SITES),
    /** Absent des versions publiées avant le transport : elles restent lisibles, sans navire. */
    ships: shipsSchema.default(DEFAULT_SHIPS),
    /** Absent des versions publiées avant le personnel : aucun salaire. */
    staff: staffSchema.default(DEFAULT_STAFF),
    /** Absent des versions publiées avant les intendants (#278) : aucun poste, aucun salaire. */
    stewards: stewardsSchema.optional(),
    /** Absent des versions publiées avant l'immobilier : aucun bien. */
    properties: propertiesSchema.default(DEFAULT_PROPERTIES),
    /** Absent des versions publiées avant le marché du travail : offre sans limite, aucun hébergement. */
    labor: laborSchema.default(DEFAULT_LABOR),
    /** Absent des versions publiées avant la taxe de marché : elles restent lisibles, sans taxe. */
    marketTax: marketTaxSchema.default(DEFAULT_MARKET_TAX),
    /** Absent des versions publiées avant l'historique des prix : chandeliers d'une heure. */
    priceHistory: priceHistorySchema.default(DEFAULT_PRICE_HISTORY),
    /** Absent des versions publiées avant la dynamique de population : population constante. */
    populationDynamics: populationDynamicsSchema.default(DEFAULT_POPULATION_DYNAMICS),
    /** Absent des versions publiées avant l'indice des prix : cible de la spécification, panier vide. */
    priceIndex: priceIndexSchema.default(DEFAULT_PRICE_INDEX),
    /** Absent des versions publiées avant la rétention de la télémétrie : 90 jours. */
    telemetry: telemetrySchema.default(DEFAULT_TELEMETRY),
    /** Absent des versions publiées avant la discussion : valeurs de `DEFAULT_CHAT`. */
    chat: chatSchema.default(DEFAULT_CHAT),
    /** Absent des versions publiées avant la modération : valeurs de `DEFAULT_MODERATION`. */
    moderation: moderationSchema.default(DEFAULT_MODERATION),
    /** Absent des versions publiées avant la passerelle IA : tous les usages coupés. */
    ai: aiSchema.default(DEFAULT_AI),
    /** Absent des versions publiées avant la chronique : valeurs de `DEFAULT_CHRONICLE`. */
    chronicle: chronicleSchema.default(DEFAULT_CHRONICLE),
    /**
     * Absent des versions publiées avant la citoyenneté : une maison y reste métèque et aucune élection
     * ne s'ouvre ; une élection déjà ouverte est dépouillée à ses dates.
     */
    politics: politicsSchema.optional(),
    /** Absent des versions publiées avant la Timè (#704) : aucune Timè ne change. */
    honor: honorSchema.optional(),
    /** Absent des versions publiées avant les liturgies (#719) : aucune maison n'est désignée. */
    liturgies: liturgiesSchema.optional(),
    /** Absent des versions publiées avant l'Hybris (#734) : aucune jauge ne change, tout palier est nul. */
    hubris: hubrisSchema.optional(),
    /** Absent des versions publiées avant le Trésor du temple (#724) : le temple ne prête pas. */
    templeTreasury: templeTreasurySchema.optional(),
    /** Absent des versions publiées avant les banques (#726), et de la configuration initiale : aucune banque ne se fonde. */
    banks: banksSchema.optional(),
    /** Absent des versions publiées avant les décrets : aucun décret ne se propose. */
    decrees: decreesSchema.optional(),
    /** Absent des versions publiées avant les événements du monde (#267) : aucun événement planifié. */
    worldEvents: worldEventsSchema.optional(),
    /** Absent des versions publiées avant les maisons PNJ de secours (#715) : aucune maison PNJ n'est fondée. */
    npcHouses: npcHousesSchema.default({}),
    /** Absent des versions publiées avant le retrait (#717) : aucune maison PNJ ne se retire devant les joueurs. */
    npcRetreat: npcRetreatSchema.optional(),
    /** Absent des versions publiées avant les quatre cités : aucun dieu, donc aucun dieu protecteur. */
    gods: z.array(godSchema).max(100).default([]),
    /** Absent des versions publiées avant les grâces (#266) : aucune grâce ne s'invoque. */
    graces: z.array(graceSchema).max(300).default([]),
    /** Absent des versions publiées avant la Pythie (#270) : aucune consultation de l'oracle. */
    oracle: oracleSchema.optional(),
    goods: z.array(goodSchema).min(1),
    recipes: z.array(recipeSchema),
    npcClasses: z.array(npcClassSchema).min(1),
    cities: z.array(cityConfigSchema).min(1),
  })
  .superRefine((config, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const goods = new Set(config.goods.map((good) => good.id));
    if (config.decrees)
      for (const { path, message } of decreesIssues(config.decrees, goods))
        issue(['decrees', ...path], message);
    const classes = new Set(config.npcClasses.map((npcClass) => npcClass.id));
    if (config.worldEvents) {
      const bought = new Set(
        config.npcClasses.flatMap((c) => c.basket.map((entry) => entry.goodId)),
      );
      for (const { path, message } of worldEventsIssues(config.worldEvents, bought))
        issue(['worldEvents', ...path], message);
    }

    // Une fenêtre plus courte qu'un chandelier n'en retiendrait aucun une partie du temps, sans erreur.
    // Une fenêtre déjà hors bornes a son propre message : pas de second reproche.
    const { candleMinutes, referenceWindowHours } = config.priceHistory;
    if (referenceWindowHours >= 1 && referenceWindowHours * 60 < candleMinutes) {
      issue(
        ['priceHistory', 'referenceWindowHours'],
        `the window must last at least one candle (${candleMinutes} minutes)`,
      );
    }
    for (const key of ['gods', 'goods', 'recipes', 'npcClasses', 'cities'] as const) {
      for (const duplicate of duplicates(config[key].map((row) => row.id))) {
        issue([key], `duplicate id "${duplicate}"`);
      }
    }
    for (const duplicate of duplicates(config.ships.classes.map((row) => row.id))) {
      issue(['ships', 'classes'], `duplicate id "${duplicate}"`);
    }
    // Immobilier : des tailles uniques, des biens de rénovation connus, des cités et des tailles connues.
    const sizeIds = new Set(config.properties.sizes.map((row) => row.id));
    for (const duplicate of duplicates(config.properties.sizes.map((row) => row.id)))
      issue(['properties', 'sizes'], `duplicate id "${duplicate}"`);
    config.properties.sizes.forEach((size, index) => {
      const path = ['properties', 'sizes', index, 'renovation', 'goods'];
      for (const duplicate of duplicates(size.renovation.goods.map((entry) => entry.goodId)))
        issue(path, `duplicate good "${duplicate}"`);
      size.renovation.goods.forEach((entry, position) => {
        if (!goods.has(entry.goodId))
          issue([...path, position, 'goodId'], `unknown good "${entry.goodId}"`);
      });
    });
    for (const [cityId, counts] of Object.entries(config.properties.countsByCity)) {
      if (!config.cities.some((city) => city.id === cityId))
        issue(['properties', 'countsByCity', cityId], `unknown city "${cityId}"`);
      for (const sizeId of Object.keys(counts))
        if (!sizeIds.has(sizeId))
          issue(['properties', 'countsByCity', cityId, sizeId], `unknown size "${sizeId}"`);
    }
    // Tarifs du transport : des classes connues, et toutes dès qu'une l'est (une classe oubliée
    // voyagerait gratuitement) ; des routes entre deux cités à port, sans doublon dans un sens ou l'autre.
    const shipClassIds = config.ships.classes.map((row) => row.id);
    const portCities = new Map(config.cities.map((city) => [city.id, cityHasPort(city)]));
    const byClass = (fees: Record<string, number>, path: (string | number)[]) => {
      for (const classId of Object.keys(fees))
        if (!shipClassIds.includes(classId)) issue(path, `unknown ship class "${classId}"`);
      if (Object.keys(fees).length > 0)
        for (const classId of shipClassIds)
          if (!Object.hasOwn(fees, classId)) issue(path, `missing ship class "${classId}"`);
    };
    byClass(config.ships.portDues.byClassOboles, ['ships', 'portDues', 'byClassOboles']);
    // Le coefficient module le droit de port d'une arrivée : seule une cité à port en a un.
    for (const cityId of Object.keys(config.ships.portDues.cityCoefficientBps)) {
      const hasPort = portCities.get(cityId);
      if (hasPort === undefined)
        issue(['ships', 'portDues', 'cityCoefficientBps', cityId], `unknown city "${cityId}"`);
      else if (!hasPort)
        issue(['ships', 'portDues', 'cityCoefficientBps', cityId], `city "${cityId}" has no port`);
    }
    const routeKeys = config.ships.routes.map(({ cities }) => [...cities].sort().join(' '));
    for (const duplicate of duplicates(routeKeys))
      issue(['ships', 'routes'], `duplicate route "${duplicate}"`);
    config.ships.routes.forEach((route, index) => {
      if (route.cities[0] === route.cities[1])
        issue(['ships', 'routes', index, 'cities'], 'a route links two different cities');
      route.cities.forEach((cityId, position) => {
        const hasPort = portCities.get(cityId);
        if (hasPort === undefined)
          issue(['ships', 'routes', index, 'cities', position], `unknown city "${cityId}"`);
        else if (!hasPort)
          issue(['ships', 'routes', index, 'cities', position], `city "${cityId}" has no port`);
      });
      byClass(route.provisionsOboles, ['ships', 'routes', index, 'provisionsOboles']);
    });
    config.recipes.forEach((recipe, index) => {
      const consumed = new Set(recipe.inputs.map((entry) => entry.goodId));
      recipe.outputs.forEach((entry, position) => {
        if (consumed.has(entry.goodId)) {
          issue(
            ['recipes', index, 'outputs', position, 'goodId'],
            `good "${entry.goodId}" is both consumed and produced`,
          );
        }
      });
      for (const side of ['inputs', 'outputs'] as const) {
        for (const duplicate of duplicates(recipe[side].map((entry) => entry.goodId))) {
          issue(['recipes', index, side], `duplicate good "${duplicate}"`);
        }
        recipe[side].forEach((entry, position) => {
          if (!goods.has(entry.goodId)) {
            issue(['recipes', index, side, position, 'goodId'], `unknown good "${entry.goodId}"`);
          }
        });
      }
    });
    const startingRecipe = config.recipes.find(
      (recipe) => recipe.id === config.starting.siteRecipeId,
    );
    if (!startingRecipe) {
      issue(['starting', 'siteRecipeId'], `unknown recipe "${config.starting.siteRecipeId}"`);
    } else if (startingRecipe.inputs.length > 0) {
      issue(['starting', 'siteRecipeId'], 'the starting site must run a recipe without inputs');
    }
    for (const duplicate of duplicates(config.priceIndex.basket.map((entry) => entry.goodId))) {
      issue(['priceIndex', 'basket'], `duplicate good "${duplicate}"`);
    }
    config.priceIndex.basket.forEach((entry, position) => {
      if (!goods.has(entry.goodId)) {
        issue(['priceIndex', 'basket', position, 'goodId'], `unknown good "${entry.goodId}"`);
      }
    });
    config.npcClasses.forEach((npcClass, index) => {
      for (const duplicate of duplicates(npcClass.basket.map((entry) => entry.goodId))) {
        issue(['npcClasses', index, 'basket'], `duplicate good "${duplicate}"`);
      }
      npcClass.basket.forEach((entry, position) => {
        if (!goods.has(entry.goodId)) {
          issue(
            ['npcClasses', index, 'basket', position, 'goodId'],
            `unknown good "${entry.goodId}"`,
          );
        }
      });
    });
    const gods = new Set(config.gods.map((god) => god.id));
    // Charis : des biens connus. Un bien retiré de la configuration doit l'être aussi des offrandes.
    config.gods.forEach((god, index) => {
      for (const goodId of Object.keys(god.charisPerUnit))
        if (!goods.has(goodId))
          issue(['gods', index, 'charisPerUnit', goodId], `unknown good "${goodId}"`);
    });
    for (const { path, message } of gracesIssues(config.graces, gods))
      issue(['graces', ...path], message);
    if (config.oracle)
      for (const { path, message } of oracleIssues(config.oracle, config.gods))
        issue(['oracle', ...path], message);
    const recipes = new Map(config.recipes.map((recipe) => [recipe.id, recipe]));
    const cityById = new Map(config.cities.map((city) => [city.id, city]));
    for (const { path, message } of npcHousesIssues(config.npcHouses, {
      cities: new Set(cityById.keys()),
      recipes: new Set(recipes.keys()),
      admits: (cityId, recipeId) => {
        const recipe = recipes.get(recipeId);
        return recipe !== undefined && cityTerroirAdmits(cityById.get(cityId), recipe);
      },
      referencePrice: (goodId) =>
        config.goods.find((good) => good.id === goodId)?.referencePriceOboles,
      inputs: (recipeId) => recipes.get(recipeId)?.inputs.map((input) => input.goodId) ?? [],
      outputs: (recipeId) => recipes.get(recipeId)?.outputs.map((output) => output.goodId) ?? [],
    }))
      issue(['npcHouses', ...path], message);
    // L'écart entre les deux seuils du retrait (#717) évite les allers-retours : le seuil bas est sous le seuil haut.
    if (config.npcRetreat && config.npcRetreat.lowShareBps >= config.npcRetreat.highShareBps)
      issue(['npcRetreat', 'lowShareBps'], 'not below highShareBps');
    // Les règles des maisons PNJ se mènent au pas des intendants (#716) : sans eux, aucune ne serait menée.
    const npcRules = Object.values(config.npcHouses).some((city) =>
      city.chains.some((chain) =>
        Object.values(chain.rules ?? {}).some((rules) => rules.length > 0),
      ),
    );
    if (npcRules && !config.stewards)
      issue(['npcHouses'], 'rules need the stewards section, whose pace they follow');
    // Salaires : des cités connues, et toutes dès qu'une l'est (une cité oubliée aurait des travailleurs
    // gratuits). `Object.hasOwn` : une cité nommée comme une propriété d'objet n'est pas « déjà là ».
    const wages = config.staff.dailyWageOboles;
    const cityIds = new Set(config.cities.map((city) => city.id));
    for (const cityId of Object.keys(wages)) {
      if (!cityIds.has(cityId))
        issue(['staff', 'dailyWageOboles', cityId], `unknown city "${cityId}"`);
    }
    if (Object.keys(wages).length > 0) {
      for (const city of config.cities) {
        if (!Object.hasOwn(wages, city.id))
          issue(['staff', 'dailyWageOboles'], `missing city "${city.id}"`);
      }
    }
    // Marché du travail (#258) : des classes travailleuses connues.
    for (const classId of Object.keys(config.labor.workingShareBps))
      if (!classes.has(classId))
        issue(['labor', 'workingShareBps', classId], `unknown NPC class "${classId}"`);
    // Dû d'un jour d'un site (5.5) : ⌈entretien × coefficient⌉ + travailleurs × salaire du jour, au plus
    // à la borne haute de la courbe (#258), + travailleurs × hébergement, au plus à la sienne. Au-delà des
    // entiers sûrs, le calcul est refusé (`siteDailyDue`) et la clôture échouerait pour tout le monde :
    // la version est refusée avant. Calcul exact en entiers longs.
    const { coefficientBps, dailyOboles } = config.sites.upkeep;
    const ceilBps = (amount: number, bps: number) =>
      (BigInt(amount) * BigInt(bps) + 9_999n) / 10_000n;
    const highestWage = Object.entries(wages).reduce<[string, number] | null>(
      (top, entry) => (top === null || entry[1] > top[1] ? entry : top),
      null,
    );
    const { lodging, wage } = config.labor;
    const lodgingCap = ceilBps(lodging.baseOboles, lodging.maxBps);
    const wageCap = highestWage === null ? 0n : ceilBps(highestWage[1], wage.maxBps);
    if (wageCap > 0n || lodgingCap > 0n) {
      const where = highestWage?.[0] ?? config.cities[0]?.id ?? '';
      config.recipes.forEach((recipe, index) => {
        const upkeep = ceilBps(dailyOboles[recipe.siteType], coefficientBps);
        const due = BigInt(recipe.workers) * (wageCap + lodgingCap) + upkeep;
        if (due > BigInt(Number.MAX_SAFE_INTEGER))
          issue(
            ['recipes', index, 'workers'],
            `a day of upkeep, wages and lodging in "${where}" exceeds the safe integer range`,
          );
      });
    }
    config.cities.forEach((city, index) => {
      if (city.patronGodId !== undefined && !gods.has(city.patronGodId)) {
        issue(['cities', index, 'patronGodId'], `unknown god "${city.patronGodId}"`);
      }
      for (const duplicate of duplicates(city.terroir ?? [])) {
        issue(['cities', index, 'terroir'], `duplicate recipe "${duplicate}"`);
      }
      city.terroir?.forEach((recipeId, position) => {
        const recipe = recipes.get(recipeId);
        if (!recipe) {
          issue(['cities', index, 'terroir', position], `unknown recipe "${recipeId}"`);
        } else if (isWorkshop(recipe)) {
          issue(['cities', index, 'terroir', position], 'workshops are admitted in every city');
        }
      });
      const ownStart = city.startingRecipeId;
      if (ownStart !== undefined) {
        const recipe = recipes.get(ownStart);
        if (!recipe) {
          issue(['cities', index, 'startingRecipeId'], `unknown recipe "${ownStart}"`);
        } else if (recipe.inputs.length > 0) {
          issue(
            ['cities', index, 'startingRecipeId'],
            'the starting site must run a recipe without inputs',
          );
        }
      }
      // La recette de départ de la cité, la sienne ou la commune, doit pouvoir y tourner. Une recette
      // inconnue a déjà son propre message : pas de second reproche.
      const start = ownStart ?? config.starting.siteRecipeId;
      const startRecipe = recipes.get(start);
      if (startRecipe && !cityTerroirAdmits(city, startRecipe)) {
        issue(
          ['cities', index, ownStart === undefined ? 'terroir' : 'startingRecipeId'],
          `the starting recipe "${start}" is not in the terroir`,
        );
      }
      for (const classId of Object.keys(city.population)) {
        if (!classes.has(classId)) {
          issue(['cities', index, 'population', classId], `unknown NPC class "${classId}"`);
        }
      }
      for (const classId of classes) {
        if (!Object.hasOwn(city.population, classId)) {
          issue(['cities', index, 'population'], `missing NPC class "${classId}"`);
        }
      }
    });
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;
export type CityConfig = z.infer<typeof cityConfigSchema>;
export type Good = z.infer<typeof goodSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type ShipClass = z.infer<typeof shipClassSchema>;
export type Politics = z.infer<typeof politicsSchema>;
export type ShipRoute = z.infer<typeof shipRouteSchema>;
export type NpcClass = z.infer<typeof npcClassSchema>;
export type PropertySize = z.infer<typeof propertySizeSchema>;
export type God = z.infer<typeof godSchema>;

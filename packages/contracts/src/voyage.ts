import { z } from 'zod';

const goodId = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const oboles = z.number().int().nonnegative();

/** Une ligne de cargaison : un bien et sa quantité, en unités entières positives. */
export const cargoLineSchema = z.strictObject({
  goodId,
  quantity: z.number().int().positive().max(1_000_000),
});

/** Une cargaison : chaque bien au plus une fois. Vide : le navire part sur lest. */
export const cargoSchema = z
  .array(cargoLineSchema)
  .max(50)
  .refine((cargo) => new Set(cargo.map((line) => line.goodId)).size === cargo.length, {
    message: 'each good appears once',
  });

/**
 * Commande `voyage.depart` (docs/specs/04-systemes-gestion.md, 4.6) : un navire de la maison, à quai dans
 * la cité de départ, part vers la cité d'arrivée avec une cargaison prise dans le stock libre de la maison
 * dans la cité de départ.
 */
export const voyageDepartInputSchema = z.strictObject({
  shipId: z.uuid(),
  /** Cité où le joueur voit le navire à quai : un navire ailleurs est refusé (`SHIP_NOT_IN_CITY`). */
  fromCityId: z.uuid(),
  toCityId: z.uuid(),
  cargo: cargoSchema,
  /**
   * Coût que le joueur a vu, en oboles : provisions plus droit de port. Un autre coût en vigueur est
   * refusé (`PRICE_CHANGED`), pas prélevé. Obligatoire : aucun client antérieur ne l'omet.
   */
  expectedCostOboles: oboles,
});
export type VoyageDepartInput = z.infer<typeof voyageDepartInputSchema>;

export const voyageDepartOutputSchema = z.object({
  voyageId: z.uuid(),
  shipId: z.uuid(),
  fromCityId: z.uuid(),
  toCityId: z.uuid(),
  departedAt: z.iso.datetime(),
  /** Arrivée prévue : le départ plus la durée du trajet. */
  arrivesAt: z.iso.datetime(),
  cargo: z.array(cargoLineSchema),
  /** Provisions payées, en oboles (détruites). */
  provisionsOboles: oboles,
  /** Droit de port de la cité d'arrivée payé, en oboles. */
  portDuesOboles: oboles,
  /** Ce que la maison a payé : provisions plus droit de port. */
  costOboles: oboles,
});
export type VoyageDepartOutput = z.infer<typeof voyageDepartOutputSchema>;

export const VOYAGE_DEPART_ERROR_CODES = [
  /** Navire inexistant ou d'une autre maison, indiscernables. */
  'SHIP_NOT_FOUND',
  /** Le navire est en mer : il n'a pas de cité de départ. */
  'SHIP_AT_SEA',
  /** Le navire est à quai ailleurs que dans la cité de départ annoncée. */
  'SHIP_NOT_IN_CITY',
  /** Le navire est désarmé, entretien impayé, jusqu'à une clôture qui le paie. */
  'SHIP_LAID_UP',
  /** Sa classe n'est plus dans la configuration en vigueur : ni capacité, ni vitesse. */
  'SHIP_CLASS_RETIRED',
  /** Cité d'arrivée inconnue de ce monde. */
  'CITY_NOT_FOUND',
  /** Aucune route de la configuration en vigueur ne relie les deux cités. */
  'NO_ROUTE',
  /** Un bien de la cargaison est inconnu de la configuration. */
  'GOOD_NOT_FOUND',
  /** La cargaison dépasse la capacité du navire, tous biens confondus. */
  'CARGO_OVER_CAPACITY',
  /** Le stock libre de la maison dans la cité de départ (hors ventes en attente) ne couvre pas un bien. */
  'INSUFFICIENT_STOCK',
  'INSUFFICIENT_FUNDS',
  /** Le coût en vigueur n'est pas celui que le client a envoyé : rien n'est payé ni chargé. */
  'PRICE_CHANGED',
] as const;
export type VoyageDepartErrorCode = (typeof VOYAGE_DEPART_ERROR_CODES)[number];

export const voyageDepartedSchema = z.strictObject({
  type: z.literal('VoyageDeparted'),
  payload: z
    .strictObject({
      voyageId: z.uuid(),
      shipId: z.uuid(),
      houseId: z.uuid(),
      fromCityId: z.uuid(),
      toCityId: z.uuid(),
      departedAt: z.iso.datetime(),
      arrivesAt: z.iso.datetime(),
      cargo: z.array(cargoLineSchema),
      provisionsOboles: oboles,
      /** Droit de port : le tout, sa part détruite et celle du trésor de la cité d'arrivée. */
      portDues: z
        .strictObject({ oboles, burned: oboles, treasury: oboles })
        .refine((dues) => dues.oboles === dues.burned + dues.treasury, {
          message: 'port dues parts must add up',
        }),
      /** Tempête de la route au départ (7.4, #267) : le retard qu'elle ajoute au trajet ; absente sans retard. */
      storm: z
        .strictObject({ eventId: z.uuid(), delaySeconds: z.number().int().positive() })
        .optional(),
    })
    .refine((payload) => payload.fromCityId !== payload.toCityId, {
      message: 'a voyage links two different cities',
    }),
});

/**
 * Arrivée d'un voyage, jouée par le moteur (4.6, #253) : au premier tick qui commence à son échéance ou
 * après, la cargaison passe de l'extrémité `in_transit` au stock de la maison dans la cité d'arrivée et
 * le navire y est à quai. `arrivedAt` est l'instant de ce tick, jamais avant l'arrivée prévue.
 */
export const voyageArrivedSchema = z.strictObject({
  type: z.literal('VoyageArrived'),
  payload: z
    .strictObject({
      voyageId: z.uuid(),
      shipId: z.uuid(),
      houseId: z.uuid(),
      fromCityId: z.uuid(),
      toCityId: z.uuid(),
      /** Arrivée prévue au départ. */
      arrivesAt: z.iso.datetime(),
      /** Instant du tick qui a déchargé le voyage. */
      arrivedAt: z.iso.datetime(),
      /** Ce qui a été déchargé : exactement ce qui avait été chargé. Vide pour un navire sur lest. */
      cargo: z.array(cargoLineSchema),
    })
    .refine((payload) => payload.fromCityId !== payload.toCityId, {
      message: 'a voyage links two different cities',
    })
    .refine((payload) => Date.parse(payload.arrivedAt) >= Date.parse(payload.arrivesAt), {
      message: 'a voyage does not arrive before it is due',
    }),
});

import { z } from 'zod';
import { MAX_ORDER_PRICE } from './market';

/**
 * Immobilier entre maisons (docs/specs/04-systemes-gestion.md, 4.5 ; ticket 257) : offres de vente et de
 * location, baux et revente. Prix et loyers en oboles entières, sous la même borne technique que l'agora.
 */
const oboles = z.number().int().positive().max(MAX_ORDER_PRICE);
const offerKind = z.enum(['sale', 'lease']);

/** Commande `property.offerLease` : la maison propose à la location un bien qu'elle possède. */
export const propertyOfferLeaseInputSchema = z.strictObject({
  propertyId: z.uuid(),
  /** Loyer quotidien demandé, payé par le locataire à chaque clôture. */
  rentOboles: oboles,
});
export type PropertyOfferLeaseInput = z.infer<typeof propertyOfferLeaseInputSchema>;

/** Commande `property.listForSale` : la maison met en vente, à prix affiché, un bien qu'elle possède. */
export const propertyListForSaleInputSchema = z.strictObject({
  propertyId: z.uuid(),
  priceOboles: oboles,
});
export type PropertyListForSaleInput = z.infer<typeof propertyListForSaleInputSchema>;

/** Sortie commune des deux offres : l'offre ouverte. */
export const propertyOfferOutputSchema = z.object({
  listingId: z.uuid(),
  propertyId: z.uuid(),
  kind: offerKind,
  /** Prix de vente, ou loyer quotidien. */
  priceOboles: oboles,
});
export type PropertyOfferOutput = z.infer<typeof propertyOfferOutputSchema>;

export const PROPERTY_OFFER_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Bien inconnu, ou d'un autre monde que celui de la maison. */
  'PROPERTY_NOT_FOUND',
  /** Le bien est à la cité ou à une autre maison. */
  'PROPERTY_NOT_OWNED',
  /** Le bien est loué : il ne s'offre ni à la vente ni à la location avant la fin du bail. */
  'PROPERTY_LEASED',
  /** Une offre du bien est déjà ouverte : la retirer d'abord. */
  'PROPERTY_ALREADY_LISTED',
  /** Le bien garantit un prêt de banque non remboursé (#728) : il ne s'offre ni à la vente ni à la location. */
  'PROPERTY_PLEDGED',
] as const;
export type PropertyOfferErrorCode = (typeof PROPERTY_OFFER_ERROR_CODES)[number];

/** Commande `property.withdrawOffer` : la maison retire l'offre ouverte d'un de ses biens. */
export const propertyWithdrawOfferInputSchema = z.strictObject({ propertyId: z.uuid() });
export type PropertyWithdrawOfferInput = z.infer<typeof propertyWithdrawOfferInputSchema>;
export const propertyWithdrawOfferOutputSchema = z.object({
  listingId: z.uuid(),
  propertyId: z.uuid(),
  kind: offerKind,
});
export type PropertyWithdrawOfferOutput = z.infer<typeof propertyWithdrawOfferOutputSchema>;
export const PROPERTY_WITHDRAW_OFFER_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  'PROPERTY_NOT_FOUND',
  'PROPERTY_NOT_OWNED',
  /** Aucune offre ouverte : jamais offert, déjà retiré, vendu ou loué. */
  'PROPERTY_NOT_LISTED',
] as const;

/** Commande `property.lease` : la maison loue un bien offert à la location, au loyer qu'elle a vu. */
export const propertyLeaseInputSchema = z.strictObject({
  propertyId: z.uuid(),
  /** Loyer que le joueur a vu : un autre loyer est refusé (`PRICE_CHANGED`), aucun bail n'est signé. */
  expectedRentOboles: oboles,
});
export type PropertyLeaseInput = z.infer<typeof propertyLeaseInputSchema>;
export const propertyLeaseOutputSchema = z.object({
  leaseId: z.uuid(),
  propertyId: z.uuid(),
  cityId: z.uuid(),
  sizeId: z.string(),
  rentOboles: oboles,
});
export type PropertyLeaseOutput = z.infer<typeof propertyLeaseOutputSchema>;
export const PROPERTY_LEASE_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  'PROPERTY_NOT_FOUND',
  /** Aucune offre de location ouverte : retirée, louée par une autre maison, ou jamais offerte. */
  'PROPERTY_NOT_FOR_LEASE',
  /** Une maison ne loue pas son propre bien. */
  'OWN_PROPERTY',
  'PRICE_CHANGED',
] as const;

/** Commande `property.endLease` : l'une ou l'autre partie demande la fin du bail, effective à la clôture. */
export const propertyEndLeaseInputSchema = z.strictObject({ leaseId: z.uuid() });
export type PropertyEndLeaseInput = z.infer<typeof propertyEndLeaseInputSchema>;
const party = z.enum(['landlord', 'tenant']);
export const propertyEndLeaseOutputSchema = z.object({
  leaseId: z.uuid(),
  propertyId: z.uuid(),
  requestedBy: party,
});
export type PropertyEndLeaseOutput = z.infer<typeof propertyEndLeaseOutputSchema>;
export const PROPERTY_END_LEASE_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Bail inconnu, terminé, ou dont la maison n'est pas partie. */
  'LEASE_NOT_FOUND',
  /** La fin est déjà demandée : elle prendra effet à la prochaine clôture. */
  'LEASE_ENDING',
] as const;

/** Commande `property.buyListed` : la maison achète un bien mis en vente, au prix qu'elle a vu. */
export const propertyBuyListedInputSchema = z.strictObject({
  propertyId: z.uuid(),
  /** Prix que le joueur a vu : un autre prix est refusé (`PRICE_CHANGED`), rien n'est payé. */
  expectedPriceOboles: oboles,
});
export type PropertyBuyListedInput = z.infer<typeof propertyBuyListedInputSchema>;
export const propertyBuyListedOutputSchema = z.object({
  propertyId: z.uuid(),
  cityId: z.uuid(),
  sizeId: z.string(),
  /** Prix payé par l'acheteur. */
  priceOboles: oboles,
});
export type PropertyBuyListedOutput = z.infer<typeof propertyBuyListedOutputSchema>;
export const PROPERTY_BUY_LISTED_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  'PROPERTY_NOT_FOUND',
  /** Aucune offre de vente ouverte : retirée, vendue, ou jamais offerte. */
  'PROPERTY_NOT_FOR_SALE',
  /** Une maison n'achète pas son propre bien. */
  'OWN_PROPERTY',
  'PRICE_CHANGED',
  'INSUFFICIENT_FUNDS',
] as const;

const listing = {
  listingId: z.uuid(),
  propertyId: z.uuid(),
  houseId: z.uuid(),
  kind: offerKind,
};
export const propertyOfferedSchema = z.strictObject({
  type: z.literal('PropertyOffered'),
  payload: z.strictObject({ ...listing, cityId: z.uuid(), priceOboles: oboles }),
});
export const propertyOfferWithdrawnSchema = z.strictObject({
  type: z.literal('PropertyOfferWithdrawn'),
  payload: z.strictObject(listing),
});
const lease = {
  leaseId: z.uuid(),
  propertyId: z.uuid(),
  landlordHouseId: z.uuid(),
  tenantHouseId: z.uuid(),
};
export const leaseStartedSchema = z.strictObject({
  type: z.literal('LeaseStarted'),
  payload: z.strictObject({ ...lease, cityId: z.uuid(), rentOboles: oboles }),
});
export const leaseEndRequestedSchema = z.strictObject({
  type: z.literal('LeaseEndRequested'),
  payload: z.strictObject({ ...lease, requestedBy: party }),
});
/** Fin d'un bail, à la clôture du jour de jeu `gameDay` : demandée, ou faute du loyer de ce jour. */
export const leaseEndedSchema = z.strictObject({
  type: z.literal('LeaseEnded'),
  payload: z.strictObject({
    ...lease,
    reason: z.enum(['requested', 'unpaid']),
    gameDay: z.number().int().nonnegative(),
  }),
});
/** Revente : l'acheteur paie le prix, le vendeur reçoit le net de la taxe de marché de la cité du bien. */
export const propertySoldSchema = z.strictObject({
  type: z.literal('PropertySold'),
  payload: z
    .strictObject({
      propertyId: z.uuid(),
      listingId: z.uuid(),
      cityId: z.uuid(),
      sizeId: z.string(),
      sellerHouseId: z.uuid(),
      buyerHouseId: z.uuid(),
      priceOboles: oboles,
      netOboles: z.number().int().nonnegative(),
      burnedOboles: z.number().int().nonnegative(),
      treasuryOboles: z.number().int().nonnegative(),
    })
    .refine(
      (sale) => sale.netOboles + sale.burnedOboles + sale.treasuryOboles === sale.priceOboles,
      {
        message: 'the price splits into net and tax',
      },
    ),
});

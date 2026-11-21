import type { NemesisModelCode } from '@oikos/db';
import { z } from 'zod';

/** Plafond technique d'un poids, d'une baisse ou du déclin, comme pour la Timè (`honor`). */
const LIMIT = 1_000_000_000;
const weight = z.number().int().min(0).max(LIMIT);

/**
 * Hybris (docs/specs/07-dieux-faveur-evenements.md, 7.2 ; #734) : jauge cachée de chaque maison de joueur, en entiers,
 * tenue par un journal en ajout seul (`hubris_ledger`) et recalculée à chaque clôture (`hubrisDelta`, `@oikos/sim`).
 * Elle monte avec la part des ventes d'une maison dans les échanges d'un bien et d'une cité au-delà de
 * `marketShareThresholdBps`, sur `marketShareWindowDays` jours, avec sa fortune au-delà de `wealthMultipleBps` fois la
 * médiane du monde, et avec chaque liturgie prélevée d'office. Elle baisse avec les oboles offertes (offrandes et faste
 * des liturgies), chaque liturgie accomplie, et d'un déclin quotidien. Le joueur ne lit que son palier : le nombre de
 * bornes de `tiers` que sa jauge atteint. Poids, baisses et déclin nuls au départ : la jauge ne bouge pas.
 */
/**
 * Modèles de sanction de Némésis (7.2, #735), dans l'ordre du tirage : l'incendie d'entrepôt détruit une part bornée d'un
 * stock, le procès prend une amende, part bornée de la trésorerie, l'artisan qui déserte arrête un atelier jusqu'à la
 * clôture suivante, le navire perdu emporte la cargaison d'un voyage en mer. Même liste que la contrainte de la base
 * (`nemesis_omens.model`, type `NemesisModelCode` de `@oikos/db`).
 */
export const NEMESIS_MODELS = [
  'warehouse_fire',
  'lawsuit',
  'artisan_desertion',
  'ship_lost',
] as const satisfies readonly NemesisModelCode[];
export type NemesisModel = (typeof NEMESIS_MODELS)[number];

/** Part bornée de ce que prend une sanction, en points de base : `minBps` au moindre excès, `maxBps` à l'excès plein. */
const nemesisShareSchema = z
  .strictObject({
    minBps: z.number().int().min(0).max(10_000),
    maxBps: z.number().int().min(1).max(10_000),
  })
  .refine((share) => share.minBps <= share.maxBps, 'minBps does not exceed maxBps');

/**
 * Némésis (7.2, #735) : quand la jauge d'une maison dépasse strictement `threshold`, la clôture lui adresse un présage et
 * fixe une sanction `omenLeadDays` jours plus tard ; à l'échéance, si la jauge dépasse encore le seuil en vigueur, la
 * sanction frappe, sinon elle est évitée. Son ampleur croît avec l'excès de la jauge au-delà du seuil, de la borne basse
 * à la borne haute du modèle, atteinte à `fullExcess`, et la jauge redescend de l'excès ainsi compté. Un modèle absent
 * n'est pas tiré. Le plus grand entier sûr comme seuil : la jauge, qui ne le dépasse jamais, n'appelle aucun présage.
 */
export const nemesisSchema = z.strictObject({
  /** Jauge au-delà de laquelle (strictement) Némésis s'annonce. */
  threshold: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  /** Délai entre le présage et l'échéance de la sanction, en jours de jeu. */
  omenLeadDays: z.number().int().min(1).max(30),
  /** Excès de jauge au-delà du seuil qui porte l'ampleur à la borne haute du modèle, et la plus forte baisse. */
  fullExcess: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  /** Modèles en jeu, tirés avec la même chance ; au moins un. */
  models: z
    .strictObject({
      warehouse_fire: nemesisShareSchema.optional(),
      lawsuit: nemesisShareSchema.optional(),
      artisan_desertion: z.strictObject({}).optional(),
      ship_lost: z.strictObject({}).optional(),
    })
    .refine((models) => NEMESIS_MODELS.some((model) => models[model]), 'at least one model'),
});
export type NemesisRules = z.infer<typeof nemesisSchema>;

export const hubrisSchema = z.strictObject({
  /** Part des ventes d'un bien dans une cité au-delà de laquelle la jauge monte, en points de base (3 500 : 35 %). */
  marketShareThresholdBps: z.number().int().min(0).max(10_000),
  /** Fenêtre des échanges comptés, en jours de jeu, jusqu'à l'instant de la clôture. */
  marketShareWindowDays: z.number().int().min(1).max(366),
  /** Multiple de la fortune médiane au-delà duquel la jauge monte, en points de base (30 000 : trois fois). */
  wealthMultipleBps: z.number().int().min(10_000).max(LIMIT),
  /** Hybris gagnée par jour et par marché pour une part entière (10 000 points) au-delà du seuil, au prorata. */
  marketShareWeight: weight,
  /** Hybris gagnée par jour pour une médiane de fortune au-delà du multiple, au prorata. */
  wealthWeight: weight,
  /** Hybris gagnée par liturgie prélevée d'office (dérobade, 6.4). */
  leviedLiturgyWeight: weight,
  /** Hybris retirée par obole offerte, en dix-millièmes : offrandes (7.1) et faste d'une liturgie accomplie. */
  offeringReliefBps: weight,
  /** Hybris retirée par liturgie accomplie (6.4), en plus de son faste. */
  performedLiturgyRelief: weight,
  /** Hybris retirée à chaque clôture, jusqu'à zéro. */
  dailyDecay: weight,
  /** Bornes des paliers, strictement croissantes : le palier d'une jauge est le nombre de bornes qu'elle atteint. */
  tiers: z
    .array(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER))
    .min(1)
    .max(10)
    .refine(
      (tiers) => tiers.every((bound, index) => index === 0 || bound > (tiers[index - 1] ?? 0)),
      'tier bounds are strictly increasing',
    ),
  /** Absent des versions publiées avant Némésis (#735) : aucun présage, et un présage échu est évité. */
  nemesis: nemesisSchema.optional(),
});
export type HubrisRules = z.infer<typeof hubrisSchema>;

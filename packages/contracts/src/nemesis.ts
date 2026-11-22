import { z } from 'zod';

/** Modèles de sanction de Némésis (7.2, #735), ceux de `hubris.nemesis.models` dans la configuration. */
export const nemesisModelSchema = z.enum([
  'warehouse_fire',
  'lawsuit',
  'artisan_desertion',
  'ship_lost',
]);

const day = z.number().int().nonnegative();
const amount = z.number().int().nonnegative();

/**
 * La clôture a adressé un présage à une maison de joueur dont la jauge d'Hybris dépasse le seuil : la sanction de son
 * modèle frappera à la clôture de `dueDay`, si la jauge dépasse encore le seuil. Lu par le seul serveur ; le joueur lit
 * le présage par `my_omens`.
 */
export const omenReceivedSchema = z.strictObject({
  type: z.literal('OmenReceived'),
  payload: z
    .strictObject({
      omenId: z.uuid(),
      houseId: z.uuid(),
      model: nemesisModelSchema,
      omenDay: day,
      dueDay: day,
    })
    .refine((payload) => payload.dueDay > payload.omenDay, { message: 'an omen falls due later' }),
});

/**
 * La sanction d'un présage a frappé à l'échéance : son ampleur (points de base, pour l'incendie et le procès) et ce
 * qu'elle a pris, l'amende, le stock et la quantité brûlés, l'atelier arrêté jusqu'à `resumesAt`, ou le voyage dont la
 * cargaison sera perdue à l'arrivée ; rien quand la maison n'avait rien à perdre. Jamais la jauge ni sa baisse.
 */
export const nemesisStruckSchema = z.strictObject({
  type: z.literal('NemesisStruck'),
  payload: z.strictObject({
    omenId: z.uuid(),
    houseId: z.uuid(),
    model: nemesisModelSchema,
    gameDay: day,
    magnitudeBps: z.number().int().min(0).max(10_000).nullable(),
    oboles: amount.nullable(),
    inventoryId: z.uuid().nullable(),
    goodId: z.string().nullable(),
    quantity: amount.nullable(),
    siteId: z.uuid().nullable(),
    resumesAt: z.iso.datetime().nullable(),
    voyageId: z.uuid().nullable(),
  }),
});

/** La jauge était redescendue sous le seuil à l'échéance, ou les règles de Némésis n'étaient plus en vigueur : rien. */
export const nemesisAvertedSchema = z.strictObject({
  type: z.literal('NemesisAverted'),
  payload: z.strictObject({
    omenId: z.uuid(),
    houseId: z.uuid(),
    model: nemesisModelSchema,
    gameDay: day,
  }),
});

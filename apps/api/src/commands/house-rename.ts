import {
  HOUSE_RENAME_ERROR_CODES,
  houseRenameInputSchema,
  houseRenameOutputSchema,
} from '@oikos/contracts';
import { findBannedTerm } from '@oikos/config';
import { defineCommand } from '../registry';

/** Renomme la maison du joueur. Commande d'exemple du cadre : une transaction, un événement. */
export const houseRename = defineCommand({
  name: 'house.rename',
  input: houseRenameInputSchema,
  output: houseRenameOutputSchema,
  errors: HOUSE_RENAME_ERROR_CODES,
  // Un nom de maison est un texte public : refusé à un compte réduit au silence (`SILENCED`), comme un message.
  moderation: 'chat',
  // Le nom refusé ne reste pas dans le journal des commandes : celui d'une maison fondée est dans `game.houses`.
  redactInput: true,
  errorByConstraint: {
    houses_name_unique: { code: 'HOUSE_NAME_TAKEN', message: 'This house name is already taken.' },
    // Postgres et JavaScript ne connaissent pas exactement les mêmes lettres Unicode.
    houses_name_check: {
      code: 'VALIDATION_FAILED',
      message: 'Invalid house name.',
      fields: ['name'],
    },
  },
  async handler({ trx, userId, emit, config }, input) {
    // Filtre de vocabulaire de la discussion (#275, #527) : le terme trouvé n'est ni rendu ni journalisé.
    if (findBannedTerm(config.moderation.bannedTerms, input.name) !== null)
      return {
        ok: false,
        error: { code: 'MESSAGE_REJECTED', message: 'The name contains a banned term.' },
      };
    // Verrouille la maison : deux renommages simultanés s'exécutent l'un après l'autre.
    const house = await trx
      .selectFrom('game.houses')
      .select(['id', 'name'])
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    if (!house) {
      return {
        ok: false,
        error: { code: 'HOUSE_NOT_FOUND', message: 'This account has no house.' },
      };
    }
    if (house.name !== input.name) {
      await trx
        .updateTable('game.houses')
        .set({ name: input.name })
        .where('id', '=', house.id)
        .execute();
      emit({
        type: 'HouseRenamed',
        payload: { houseId: house.id, previousName: house.name, name: input.name },
      });
    }
    return { ok: true, data: { houseId: house.id, name: input.name } };
  },
});

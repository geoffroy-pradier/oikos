import {
  HOUSE_CREATE_ERROR_CODES,
  houseCreateInputSchema,
  houseCreateOutputSchema,
} from '@oikos/contracts';
import { cityStartingRecipeId, findBannedTerm } from '@oikos/config';
import { laborIsLimited, lockCityLabor, workersAvailable } from '../labor';
import { defineCommand } from '../registry';

/**
 * Fonde la maison du joueur, l'inscrit comme métèque dans sa cité d'accueil, ouvre son compte, lui verse
 * la dotation de départ (robinet `faucet_starting_grant`) et lui confie son premier site, qui lance la
 * recette de départ de cette cité (6.1), sinon la recette de départ commune. Si la cité n'offre plus les
 * travailleurs de ce site (4.4, #258), la maison n'est pas fondée : le joueur choisit une autre cité.
 */
export const houseCreate = defineCommand({
  name: 'house.create',
  input: houseCreateInputSchema,
  output: houseCreateOutputSchema,
  errors: HOUSE_CREATE_ERROR_CODES,
  // Un nom de maison est un texte public : refusé à un compte réduit au silence (`SILENCED`), comme un message.
  moderation: 'chat',
  // Le nom refusé ne reste pas dans le journal des commandes : celui d'une maison fondée est dans `game.houses`.
  redactInput: true,
  // Les contraintes de la base font foi, y compris sous concurrence.
  errorByConstraint: {
    houses_one_per_user: {
      code: 'HOUSE_ALREADY_EXISTS',
      message: 'This account already has a house.',
    },
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
    const city = await trx
      .selectFrom('game.cities')
      .select(['id', 'world_id', 'slug'])
      .where('id', '=', input.cityId)
      .executeTakeFirst();
    if (!city) return { ok: false, error: { code: 'CITY_NOT_FOUND', message: 'Unknown city.' } };
    // Un compte ne fonde qu'une maison dans tout le jeu, quel qu'en soit le monde (#604) : il l'apprend avant tout
    // contrôle des travailleurs (le déclencheur `houses_one_per_account` reste le garde-fou sous concurrence).
    const existing = await trx
      .selectFrom('game.houses')
      .select('id')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (existing)
      return {
        ok: false,
        error: { code: 'HOUSE_ALREADY_EXISTS', message: 'This account already has a house.' },
      };
    // Le schéma garantit qu'elle est connue, sans intrant, et dans le terroir de la cité.
    const siteRecipeId = cityStartingRecipeId(config, city.slug);
    const workers = config.recipes.find((recipe) => recipe.id === siteRecipeId)?.workers ?? 0;
    if (laborIsLimited(config) && workers > 0) {
      await lockCityLabor(trx, city.id);
      if (!(await workersAvailable(trx, config, city, workers)))
        return {
          ok: false,
          error: { code: 'NO_WORKERS_AVAILABLE', message: 'This city has no workers left.' },
        };
    }

    const house = await trx
      .insertInto('game.houses')
      .values({
        world_id: city.world_id,
        user_id: userId,
        name: input.name,
        blazon: JSON.stringify(input.blazon),
      })
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow();
    const citizenship = await trx
      .insertInto('game.citizenships')
      .values({ house_id: house.id, city_id: city.id })
      .returning('status')
      .executeTakeFirstOrThrow();

    // Dotation de départ : une écriture équilibrée, du robinet vers le compte de la maison.
    const account = await trx
      .insertInto('game.accounts')
      .values({ world_id: city.world_id, kind: 'house', house_id: house.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    const faucet = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', city.world_id)
      .where('system_key', '=', 'faucet_starting_grant')
      .executeTakeFirstOrThrow();
    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({
        world_id: city.world_id,
        kind: 'house.starting_grant',
        meta: JSON.stringify({ houseId: house.id }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { grantOboles } = config.starting;
    await trx
      .insertInto('game.ledger_lines')
      .values([
        { entry_id: entry.id, account_id: faucet.id, amount: -grantOboles },
        { entry_id: entry.id, account_id: account.id, amount: grantOboles },
      ])
      .execute();
    await trx
      .insertInto('game.sites')
      .values({
        world_id: city.world_id,
        house_id: house.id,
        city_id: city.id,
        recipe_id: siteRecipeId,
      })
      .execute();

    emit({
      type: 'HouseFounded',
      payload: { houseId: house.id, worldId: city.world_id, cityId: city.id, name: house.name },
    });
    return {
      ok: true,
      data: {
        houseId: house.id,
        worldId: city.world_id,
        cityId: city.id,
        name: house.name,
        citizenshipStatus: citizenship.status,
      },
    };
  },
});

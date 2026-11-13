import type { CommandError, HouseCreateInput, HouseCreateOutput } from '@oikos/contracts';
import { violatedConstraint, type Db } from '@oikos/db';

export type CommandResult<T> = { ok: true; data: T } | { ok: false; error: CommandError };

const ERROR_BY_CONSTRAINT: Record<string, CommandError> = {
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
};

/** Fonde la maison du joueur et l'inscrit comme métèque dans sa cité d'accueil, en une transaction. */
export async function houseCreate(
  db: Db,
  userId: string,
  input: HouseCreateInput,
): Promise<CommandResult<HouseCreateOutput>> {
  try {
    return await db.transaction().execute(async (trx) => {
      const city = await trx
        .selectFrom('game.cities')
        .select(['id', 'world_id'])
        .where('id', '=', input.cityId)
        .executeTakeFirst();
      if (!city) {
        return { ok: false, error: { code: 'CITY_NOT_FOUND', message: 'Unknown city.' } };
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
    });
  } catch (error) {
    // Les contraintes de la base font foi, y compris sous concurrence.
    const mapped = ERROR_BY_CONSTRAINT[violatedConstraint(error) ?? ''];
    if (!mapped) throw error;
    return { ok: false, error: mapped };
  }
}

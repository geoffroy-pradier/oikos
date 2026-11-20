import {
  CITY_CAST_OSTRACON_ERROR_CODES,
  cityCastOstraconInputSchema,
  cityCastOstraconOutputSchema,
} from '@oikos/contracts';
import { defineCommand } from '../registry';
import { houseOf, NOT_CITIZEN, refuse } from './city-election';

/**
 * Vote d'ostracisme (docs/specs/06-cites-politique-communaute.md, 6.4 ; #722) : un citoyen de la cité inscrit le
 * nom d'un citoyen de la même cité, une fois par maison, pendant le vote. Le vote est secret : ni la réponse ni
 * l'événement ne disent le nom inscrit. Sous concurrence, la base garantit le bulletin unique, la période et la
 * citoyenneté des deux maisons (garde des bulletins, qui verrouille le vote en partage).
 */
const VOTING_CLOSED = { code: 'VOTING_CLOSED', message: 'The vote is not open.' };
const ALREADY_VOTED = { code: 'ALREADY_VOTED', message: 'This house already voted.' };
const TARGET_NOT_CITIZEN = {
  code: 'TARGET_NOT_CITIZEN',
  message: 'Only a citizen of the city can be named.',
};

export const cityCastOstracon = defineCommand({
  name: 'city.castOstracon',
  input: cityCastOstraconInputSchema,
  output: cityCastOstraconOutputSchema,
  errors: CITY_CAST_OSTRACON_ERROR_CODES,
  errorByConstraint: {
    ostraca_one_per_house: ALREADY_VOTED,
    ostraca_voting_period: VOTING_CLOSED,
    ostraca_citizens_only: NOT_CITIZEN,
    ostraca_target_citizen: TARGET_NOT_CITIZEN,
  },
  async handler({ trx, userId, emit, now }, input) {
    const house = await houseOf(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const ostracism = await trx
      .selectFrom('game.ostracisms')
      .select(['id', 'city_id', 'tallied_at', 'voting_closes_at'])
      .where('id', '=', input.ostracismId)
      .where('world_id', '=', house.world_id)
      .executeTakeFirst();
    if (!ostracism) return refuse('OSTRACISM_NOT_FOUND', 'Unknown ostracism vote.');
    if (house.status !== 'citizen' || house.city_id !== ostracism.city_id)
      return { ok: false, error: NOT_CITIZEN };
    if (ostracism.tallied_at || now >= ostracism.voting_closes_at)
      return { ok: false, error: VOTING_CLOSED };
    const target = await trx
      .selectFrom('game.citizenships')
      .select('house_id')
      .where('house_id', '=', input.houseId)
      .where('city_id', '=', ostracism.city_id)
      .where('status', '=', 'citizen')
      .executeTakeFirst();
    if (!target) return { ok: false, error: TARGET_NOT_CITIZEN };
    const voted = await trx
      .selectFrom('game.ostraca')
      .select('id')
      .where('ostracism_id', '=', ostracism.id)
      .where('house_id', '=', house.id)
      .executeTakeFirst();
    if (voted) return { ok: false, error: ALREADY_VOTED };
    const ostracon = await trx
      .insertInto('game.ostraca')
      .values({ ostracism_id: ostracism.id, house_id: house.id, target_house_id: input.houseId })
      .returning('cast_at')
      .executeTakeFirstOrThrow();
    emit({
      type: 'OstraconCast',
      payload: { ostracismId: ostracism.id, cityId: ostracism.city_id, houseId: house.id },
    });
    return {
      ok: true,
      data: { ostracismId: ostracism.id, castAt: ostracon.cast_at.toISOString() },
    };
  },
});

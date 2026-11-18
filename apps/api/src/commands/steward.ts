import { randomInt } from 'node:crypto';
import { stewardLimit } from '@oikos/config';
import {
  STEWARD_DISMISS_ERROR_CODES,
  STEWARD_HIRE_ERROR_CODES,
  stewardDismissInputSchema,
  stewardDismissOutputSchema,
  stewardHireInputSchema,
  stewardHireOutputSchema,
} from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * Embauche un intendant pour un site de la maison (docs/specs/04-systemes-gestion.md, 4.4) : un par site, au plus
 * les postes du siège (`stewards.limitByHeadquartersLevel`, premier niveau). Son nom est tiré de la liste de la
 * configuration, parmi ceux que ses intendants en poste ne portent pas quand il en reste. L'embauche ne coûte
 * rien : son salaire est payé à chaque clôture, et il n'agit qu'une fois payé (#278, #279).
 */
export const stewardHire = defineCommand({
  name: 'steward.hire',
  input: stewardHireInputSchema,
  output: stewardHireOutputSchema,
  errors: STEWARD_HIRE_ERROR_CODES,
  // La base fait foi sous concurrence : un seul intendant en poste par site.
  errorByConstraint: {
    stewards_one_per_site_idx: { code: 'SITE_HAS_STEWARD', message: 'This site has a steward.' },
  },
  async handler({ trx, userId, emit, config }, input) {
    // Verrou de la maison : deux embauches simultanées se suivent, et la seconde compte la première.
    // `FOR NO KEY UPDATE` et non `FOR UPDATE` : une récolte verrouille le site puis écrit au stock, dont la clé
    // étrangère demande `FOR KEY SHARE` sur la maison, quand l'embauche, maison tenue, demande `FOR KEY SHARE` sur
    // le site (`stewards_site`). Avec `FOR UPDATE`, les deux commandes s'attendraient l'une l'autre (interblocage).
    const house = await trx
      .selectFrom('game.houses')
      .select('id')
      .where('user_id', '=', userId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    const site =
      house &&
      (await trx
        .selectFrom('game.sites')
        .select(['id', 'world_id'])
        .where('id', '=', input.siteId)
        .where('house_id', '=', house.id)
        .executeTakeFirst());
    // Le site d'un autre joueur est indiscernable d'un site inexistant.
    if (!house || !site) return refuse('SITE_NOT_FOUND', 'Unknown site.');
    const posted = await trx
      .selectFrom('game.stewards')
      .select(['site_id', 'name'])
      .where('house_id', '=', house.id)
      .where('dismissed_at', 'is', null)
      .execute();
    if (posted.some((steward) => steward.site_id === site.id))
      return refuse('SITE_HAS_STEWARD', 'This site has a steward.');
    if (posted.length >= stewardLimit(config))
      return refuse('STEWARD_LIMIT_REACHED', 'Every steward post is taken.');
    // Des postes ouverts supposent la section des intendants, et sa liste de noms n'est jamais vide.
    const names = config.stewards?.names ?? [];
    const unused = names.filter((name) => !posted.some((steward) => steward.name === name));
    const pool = unused.length > 0 ? unused : names;
    const name = pool[randomInt(pool.length)];
    if (name === undefined) throw new Error('Steward posts without names');
    const hired = await trx
      .insertInto('game.stewards')
      .values({ world_id: site.world_id, house_id: house.id, site_id: site.id, name })
      .returning(['id', 'hired_at'])
      .executeTakeFirstOrThrow();
    emit({
      type: 'StewardHired',
      payload: { stewardId: hired.id, houseId: house.id, siteId: site.id, name },
    });
    return {
      ok: true,
      data: { stewardId: hired.id, siteId: site.id, name, hiredAt: hired.hired_at.toISOString() },
    };
  },
});

/** Intendant en poste de la maison du compte, verrouillé : ses commandes se suivent, et suivent son renvoi. */
async function lockSteward(trx: Db, userId: string, stewardId: string) {
  return trx
    .selectFrom('game.stewards')
    .select(['id', 'house_id', 'site_id', 'rules_revision'])
    .where('id', '=', stewardId)
    .where('dismissed_at', 'is', null)
    .where('house_id', 'in', (houses) =>
      houses.selectFrom('game.houses').select('id').where('user_id', '=', userId),
    )
    .forUpdate()
    .executeTakeFirst();
}

/** Renvoie un intendant (4.4) : il quitte son poste, ses règles cessent avec lui ; rien n'est remboursé. */
export const stewardDismiss = defineCommand({
  name: 'steward.dismiss',
  input: stewardDismissInputSchema,
  output: stewardDismissOutputSchema,
  errors: STEWARD_DISMISS_ERROR_CODES,
  async handler({ trx, userId, emit }, input) {
    const steward = await lockSteward(trx, userId, input.stewardId);
    if (!steward) return refuse('STEWARD_NOT_FOUND', 'Unknown steward.');
    const { dismissed_at: dismissedAt } = await trx
      .updateTable('game.stewards')
      .set({ dismissed_at: sql<Date>`now()` })
      .where('id', '=', steward.id)
      .returning('dismissed_at')
      .executeTakeFirstOrThrow();
    if (!dismissedAt) throw new Error('The steward was not dismissed');
    emit({
      type: 'StewardDismissed',
      payload: { stewardId: steward.id, houseId: steward.house_id, siteId: steward.site_id },
    });
    return {
      ok: true,
      data: {
        stewardId: steward.id,
        siteId: steward.site_id,
        dismissedAt: dismissedAt.toISOString(),
      },
    };
  },
});

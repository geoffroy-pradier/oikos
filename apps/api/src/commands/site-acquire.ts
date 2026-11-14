import {
  SITE_ACQUIRE_ERROR_CODES,
  siteAcquireInputSchema,
  siteAcquireOutputSchema,
} from '@oikos/contracts';
import { defineCommand, type CommandResult } from '../registry';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * La maison acquiert un site dans sa cité (docs/specs/04-systemes-gestion.md, 4.1 et 4.2). Le type du
 * site est celui de la recette choisie ; son prix, fixé par la configuration, est détruit (puits
 * `sink_site_acquisition`). Le nombre de sites est borné par le niveau du siège.
 */
export const siteAcquire = defineCommand({
  name: 'site.acquire',
  input: siteAcquireInputSchema,
  output: siteAcquireOutputSchema,
  errors: SITE_ACQUIRE_ERROR_CODES,
  // La base fait foi sous concurrence : le compte d'une maison ne passe jamais sous zéro.
  errorByConstraint: {
    accounts_no_overdraft: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' },
  },
  async handler({ trx, userId, emit, config }, input) {
    // Verrouille la maison : deux acquisitions simultanées se suivent, la limite est comptée juste.
    const house = await trx
      .selectFrom('game.houses')
      .select(['id', 'world_id'])
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const recipe = config.recipes.find((candidate) => candidate.id === input.recipeId);
    if (!recipe) return refuse('RECIPE_NOT_FOUND', 'Unknown recipe.');
    // Les ateliers (recettes à intrants) ne se récoltent pas encore : on n'en vend pas.
    if (recipe.inputs.length > 0)
      return refuse('RECIPE_NOT_AVAILABLE', 'Workshop recipes are not available yet.');

    // Toute maison est au premier niveau de siège tant que le siège n'évolue pas.
    const limit = config.sites.limitByHeadquartersLevel[0] ?? 0;
    const owned = await trx
      .selectFrom('game.sites')
      .select((expression) => expression.fn.countAll<string>().as('n'))
      .where('house_id', '=', house.id)
      .executeTakeFirstOrThrow();
    if (Number(owned.n) >= limit)
      return refuse('SITE_LIMIT_REACHED', 'This house already runs as many sites as it may.');

    const costOboles = config.sites.acquisitionCostOboles[recipe.siteType];
    const account = await trx
      .selectFrom('game.accounts')
      .select(['id', 'balance'])
      .where('house_id', '=', house.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (Number(account.balance) < costOboles)
      return refuse('INSUFFICIENT_FUNDS', 'Not enough money.');
    const citizenship = await trx
      .selectFrom('game.citizenships')
      .select('city_id')
      .where('house_id', '=', house.id)
      .executeTakeFirstOrThrow();
    const sink = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', house.world_id)
      .where('system_key', '=', 'sink_site_acquisition')
      .executeTakeFirstOrThrow();

    const site = await trx
      .insertInto('game.sites')
      .values({
        world_id: house.world_id,
        house_id: house.id,
        city_id: citizenship.city_id,
        recipe_id: recipe.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({
        world_id: house.world_id,
        kind: 'site.acquire',
        meta: JSON.stringify({ houseId: house.id, siteId: site.id }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('game.ledger_lines')
      .values([
        { entry_id: entry.id, account_id: account.id, amount: -costOboles },
        { entry_id: entry.id, account_id: sink.id, amount: costOboles },
      ])
      .execute();

    emit({
      type: 'SiteAcquired',
      payload: {
        siteId: site.id,
        houseId: house.id,
        cityId: citizenship.city_id,
        recipeId: recipe.id,
        siteType: recipe.siteType,
        costOboles,
      },
    });
    return {
      ok: true,
      data: { siteId: site.id, recipeId: recipe.id, siteType: recipe.siteType, costOboles },
    };
  },
});

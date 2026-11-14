import {
  SITE_SET_RECIPE_ERROR_CODES,
  siteSetRecipeInputSchema,
  siteSetRecipeOutputSchema,
} from '@oikos/contracts';
import { accrueWorkshop } from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * Change la recette d'un site, parmi celles de son type. Ce qui est déjà produit doit d'abord être
 * récolté ; le cycle entamé est perdu, et le nouveau commence à l'instant présent (la base l'exige).
 */
export const siteSetRecipe = defineCommand({
  name: 'site.setRecipe',
  input: siteSetRecipeInputSchema,
  output: siteSetRecipeOutputSchema,
  errors: SITE_SET_RECIPE_ERROR_CODES,
  async handler({ trx, userId, emit, config, now }, input) {
    // Verrouille le site : une collecte simultanée passe avant ou après, jamais pendant.
    const site = await trx
      .selectFrom('game.sites')
      .select(['id', 'house_id', 'city_id', 'recipe_id', 'cycle_started_at'])
      .select(sql<boolean>`cycle_started_at > now()`.as('moved'))
      .where('id', '=', input.siteId)
      .where('house_id', 'in', (houses) =>
        houses.selectFrom('game.houses').select('id').where('user_id', '=', userId),
      )
      .forUpdate()
      .executeTakeFirst();
    // Le site d'un autre joueur est indiscernable d'un site inexistant.
    if (!site) return refuse('SITE_NOT_FOUND', 'Unknown site.');
    // Une collecte commencée après cette commande a validé avant elle et a avancé le cycle au-delà de
    // notre instant : la garde refuserait d'y revenir. Conflit à rejouer, pas une erreur interne.
    if (site.moved) return refuse('SITE_CHANGED', 'The site just changed. Try again.');
    const current = config.recipes.find((candidate) => candidate.id === site.recipe_id);
    if (!current) throw new Error(`Site ${site.id} runs unknown recipe ${site.recipe_id}`);
    const next = config.recipes.find((candidate) => candidate.id === input.recipeId);
    if (!next) return refuse('RECIPE_NOT_FOUND', 'Unknown recipe.');
    if (next.id === current.id) return refuse('RECIPE_UNCHANGED', 'The site already runs it.');
    if (next.siteType !== current.siteType)
      return refuse('RECIPE_NOT_COMPATIBLE', 'This recipe needs another type of site.');

    // « Déjà produit » : ce qu'une récolte livrerait maintenant. Un atelier à court d'intrants n'a rien
    // produit : il peut changer de recette, et ses cycles en attente sont perdus avec le cycle entamé.
    // Sans cela, il serait renvoyé d'un refus à l'autre (rien à moudre, mais « récoltez d'abord »).
    // Stocks d'intrants verrouillés dans l'ordre des biens, comme à la récolte.
    const inputGoods = current.inputs.map((stack) => stack.goodId);
    const stocks =
      inputGoods.length === 0
        ? []
        : await trx
            .selectFrom('game.inventories')
            .select(['good_id', 'quantity', 'reserved'])
            .where('house_id', '=', site.house_id)
            .where('city_id', '=', site.city_id)
            .where('good_id', 'in', inputGoods)
            .orderBy(sql`good_id collate "C"`)
            .forUpdate()
            .execute();
    const { cycles } = accrueWorkshop({
      since: site.cycle_started_at,
      now,
      cycleMinutes: current.durationMinutes,
      maxCycles: current.maxAccruedCycles,
      inputs: current.inputs.map((stack) => {
        const stock = stocks.find((candidate) => candidate.good_id === stack.goodId);
        const free = stock ? Number(stock.quantity) - Number(stock.reserved) : 0;
        return { perCycle: stack.quantity, available: free };
      }),
    });
    if (cycles > 0) return refuse('COLLECT_FIRST', 'Collect what the site has produced first.');

    // L'heure de la base, à la microseconde : la garde exige un cycle qui commence exactement maintenant.
    const changed = await trx
      .updateTable('game.sites')
      .set({ recipe_id: next.id, cycle_started_at: sql<Date>`now()` })
      .where('id', '=', site.id)
      .returning('cycle_started_at')
      .executeTakeFirstOrThrow();
    emit({
      type: 'SiteRecipeChanged',
      payload: {
        siteId: site.id,
        houseId: site.house_id,
        previousRecipeId: current.id,
        recipeId: next.id,
      },
    });
    return {
      ok: true,
      data: {
        siteId: site.id,
        recipeId: next.id,
        cycleStartedAt: changed.cycle_started_at.toISOString(),
      },
    };
  },
});

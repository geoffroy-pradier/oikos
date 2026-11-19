import {
  SITE_SET_RECIPE_ERROR_CODES,
  siteSetRecipeInputSchema,
  siteSetRecipeOutputSchema,
} from '@oikos/contracts';
import { accrueWorkshop } from '@oikos/sim';
import { cityTerroirAdmits, type Recipe } from '@oikos/config';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import { laborIsLimited, lockCityLabor, workersAvailable } from '../labor';
import { defineCommand, type CommandResult } from '../registry';
import { accountHouseId } from '@oikos/operations';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * Change la recette d'un site, parmi celles de son type et, pour une production primaire, du terroir de
 * sa cité (6.1) ; un site qui exploite déjà une recette hors terroir continue de la produire.
 * Ce qui est déjà produit doit d'abord être récolté ; le cycle entamé est perdu, et le nouveau commence à l'instant présent (la base l'exige).
 * Un site dont la recette a quitté la configuration n'a plus de type ni de production : il adopte
 * n'importe quelle recette, sans récolte préalable, et repart sans rien payer s'il était à l'arrêt.
 * Une recette qui demande plus de travailleurs que l'actuelle les demande à la cité (4.4, #258) : s'ils
 * n'y sont pas, refus, sans rien changer.
 */
export const siteSetRecipe = defineCommand({
  name: 'site.setRecipe',
  input: siteSetRecipeInputSchema,
  output: siteSetRecipeOutputSchema,
  errors: SITE_SET_RECIPE_ERROR_CODES,
  async handler({ trx, userId, emit, config, now }, input) {
    // Le verrou du marché du travail de la cité, avant celui du site, que la clôture peut tenir : la cité
    // d'un site ne change jamais, elle se lit sans verrou.
    const target = config.recipes.find((candidate) => candidate.id === input.recipeId);
    if (target && target.workers > 0 && laborIsLimited(config)) {
      const located = await trx
        .selectFrom('game.sites')
        .select('city_id')
        .where('id', '=', input.siteId)
        .where('house_id', 'in', (houses) =>
          houses.selectFrom('game.houses').select('id').where('id', '=', accountHouseId(userId)),
        )
        .executeTakeFirst();
      if (located) await lockCityLabor(trx, located.city_id);
    }
    // Verrouille le site : une collecte simultanée passe avant ou après, jamais pendant.
    const site = await trx
      .selectFrom('game.sites')
      .select(['id', 'house_id', 'city_id', 'recipe_id', 'cycle_started_at', 'halted_at'])
      .select(sql<boolean>`cycle_started_at > now()`.as('moved'))
      .select(sql<boolean>`coalesce(halted_at > now(), false)`.as('haltMoved'))
      .where('id', '=', input.siteId)
      .where('house_id', 'in', (houses) =>
        houses.selectFrom('game.houses').select('id').where('id', '=', accountHouseId(userId)),
      )
      .forUpdate()
      .executeTakeFirst();
    // Le site d'un autre joueur est indiscernable d'un site inexistant.
    if (!site) return refuse('SITE_NOT_FOUND', 'Unknown site.');
    // Une collecte commencée après cette commande a validé avant elle et a avancé le cycle au-delà de
    // notre instant : la garde refuserait d'y revenir. Conflit à rejouer, pas une erreur interne.
    if (site.moved) return refuse('SITE_CHANGED', 'The site just changed. Try again.');
    // `undefined` : la recette du site a quitté la configuration (recette retirée).
    const current = config.recipes.find((candidate) => candidate.id === site.recipe_id);
    // Un site à l'arrêt garde sa recette et son cycle gelé : il faut le relancer d'abord. La base le
    // refuserait de toute façon (le cycle d'un site à l'arrêt ne dépasse pas l'instant de l'arrêt).
    if (site.halted_at && current)
      return refuse('SITE_HALTED', 'This site is halted until its upkeep is paid.');
    // Sans recette, l'arrêt ne coûte rien à lever (5.5) : il est levé ici. Mais un arrêt postérieur à
    // notre instant (clôture commencée après la commande) ferait reculer le cycle : conflit à rejouer.
    if (site.haltMoved) return refuse('SITE_CHANGED', 'The site just changed. Try again.');
    const next = config.recipes.find((candidate) => candidate.id === input.recipeId);
    if (!next) return refuse('RECIPE_NOT_FOUND', 'Unknown recipe.');
    if (current) {
      if (next.id === current.id) return refuse('RECIPE_UNCHANGED', 'The site already runs it.');
      if (next.siteType !== current.siteType)
        return refuse('RECIPE_NOT_COMPATIBLE', 'This recipe needs another type of site.');
    }
    // Avant toute écriture, relance sans frais comprise : un refus ne change rien au site.
    const { slug } = await trx
      .selectFrom('game.cities')
      .select('slug')
      .where('id', '=', site.city_id)
      .executeTakeFirstOrThrow();
    const city = config.cities.find((candidate) => candidate.id === slug);
    if (!cityTerroirAdmits(city, next))
      return refuse('RECIPE_NOT_IN_TERROIR', 'This production does not grow in this city.');
    const extraWorkers = next.workers - (current?.workers ?? 0);
    if (!(await workersAvailable(trx, config, { id: site.city_id, slug }, extraWorkers)))
      return refuse('NO_WORKERS_AVAILABLE', 'This city has no workers left for this production.');
    if (current) {
      if (await producedSomething(trx, site, current, now))
        return refuse('COLLECT_FIRST', 'Collect what the site has produced first.');
    } else if (site.halted_at) {
      // Relance sans frais, comme `site.restart` pour un site sans tarif, puis changement de recette :
      // deux écritures, chacune conforme à la garde de la base (reprise décalée de l'arrêt, puis cycle
      // neuf à l'instant présent, qui ne recule jamais puisque l'arrêt n'est pas postérieur à lui).
      await trx
        .updateTable('game.sites')
        .set({
          cycle_started_at: sql<Date>`cycle_started_at + extract(epoch from now() - halted_at) * interval '1 second'`,
          halted_at: null,
        })
        .where('id', '=', site.id)
        .execute();
      emit({
        type: 'SiteRestarted',
        payload: { siteId: site.id, houseId: site.house_id, upkeepOboles: 0, wagesOboles: 0 },
      });
    }

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
        previousRecipeId: site.recipe_id,
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

/**
 * « Déjà produit » : ce qu'une récolte livrerait maintenant. Un atelier à court d'intrants n'a rien
 * produit : il peut changer de recette, et ses cycles en attente sont perdus avec le cycle entamé.
 * Sans cela, il serait renvoyé d'un refus à l'autre (rien à moudre, mais « récoltez d'abord »).
 * Stocks d'intrants verrouillés dans l'ordre des biens, comme à la récolte.
 */
async function producedSomething(
  trx: Db,
  site: { house_id: string; city_id: string; cycle_started_at: Date },
  current: Recipe,
  now: Date,
): Promise<boolean> {
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
  return cycles > 0;
}

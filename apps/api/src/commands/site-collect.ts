import {
  SITE_COLLECT_ERROR_CODES,
  siteCollectInputSchema,
  siteCollectOutputSchema,
} from '@oikos/contracts';
import { accrueProduction } from '@oikos/sim';
import { defineCommand } from '../registry';

/**
 * Récolte un site : la production est calculée ici, à partir de l'horodatage du cycle en cours
 * (évaluation paresseuse), puis entre en stock par le journal des stocks.
 */
export const siteCollect = defineCommand({
  name: 'site.collect',
  input: siteCollectInputSchema,
  output: siteCollectOutputSchema,
  errors: SITE_COLLECT_ERROR_CODES,
  async handler({ trx, userId, emit, config, now }, input) {
    // Verrouille le site : deux collectes simultanées s'exécutent l'une après l'autre.
    const site = await trx
      .selectFrom('game.sites')
      .select(['id', 'world_id', 'house_id', 'city_id', 'recipe_id', 'cycle_started_at'])
      .where('id', '=', input.siteId)
      .where('house_id', 'in', (houses) =>
        houses.selectFrom('game.houses').select('id').where('user_id', '=', userId),
      )
      .forUpdate()
      .executeTakeFirst();
    // Le site d'un autre joueur est indiscernable d'un site inexistant.
    if (!site) return { ok: false, error: { code: 'SITE_NOT_FOUND', message: 'Unknown site.' } };

    const recipe = config.recipes.find((candidate) => candidate.id === site.recipe_id);
    if (!recipe) throw new Error(`Site ${site.id} runs unknown recipe ${site.recipe_id}`);
    const { cycles, since } = accrueProduction({
      since: site.cycle_started_at,
      now,
      cycleMinutes: recipe.durationMinutes,
      outputPerCycle: 1,
      maxCycles: recipe.maxAccruedCycles,
    });
    if (cycles === 0) {
      const message = 'No full production cycle has elapsed yet.';
      return { ok: false, error: { code: 'NOTHING_TO_COLLECT', message } };
    }

    const outputs = recipe.outputs.map((stack) => ({
      goodId: stack.goodId,
      quantity: cycles * stack.quantity,
    }));
    for (const { goodId, quantity } of outputs) {
      const place = { house_id: site.house_id, city_id: site.city_id, good_id: goodId };
      await trx
        .insertInto('game.inventories')
        .values({ world_id: site.world_id, ...place })
        .onConflict((conflict) => conflict.constraint('inventories_unique').doNothing())
        .execute();
      const inventory = await trx
        .selectFrom('game.inventories')
        .select('id')
        .where('house_id', '=', place.house_id)
        .where('city_id', '=', place.city_id)
        .where('good_id', '=', place.good_id)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('game.stock_ledger')
        .values({
          world_id: site.world_id,
          good_id: goodId,
          quantity,
          from_system: 'production',
          to_inventory_id: inventory.id,
          kind: 'site.collect',
        })
        .execute();
    }
    await trx
      .updateTable('game.sites')
      .set({ cycle_started_at: since })
      .where('id', '=', site.id)
      .execute();

    emit({
      type: 'SiteCollected',
      payload: { siteId: site.id, houseId: site.house_id, cycles, outputs },
    });
    return {
      ok: true,
      data: { siteId: site.id, cycles, outputs, cycleStartedAt: since.toISOString() },
    };
  },
});

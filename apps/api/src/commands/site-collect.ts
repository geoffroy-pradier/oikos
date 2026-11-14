import {
  SITE_COLLECT_ERROR_CODES,
  siteCollectInputSchema,
  siteCollectOutputSchema,
} from '@oikos/contracts';
import { accrueWorkshop } from '@oikos/sim';
import { defineCommand } from '../registry';

/**
 * Récolte un site : la production est calculée ici, à partir de l'horodatage du cycle en cours
 * (évaluation paresseuse). Un atelier consomme ses intrants dans le stock libre de la maison ; à court
 * d'intrants, les cycles en attente restent dus (docs/specs/04-systemes-gestion.md, 4.3). Tout passe
 * par le journal des stocks.
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

    // Stocks touchés, intrants et extrants confondus, verrouillés dans l'ordre des biens : deux
    // récoltes de la même maison, ou une récolte et une vente, ne s'attendent jamais l'une l'autre.
    const goods = [...new Set([...recipe.inputs, ...recipe.outputs].map((stack) => stack.goodId))];
    goods.sort();
    const place = { house_id: site.house_id, city_id: site.city_id };
    // Un extrant jamais produit n'a pas encore de stock : il est ouvert, vide.
    for (const { goodId } of recipe.outputs) {
      await trx
        .insertInto('game.inventories')
        .values({ world_id: site.world_id, ...place, good_id: goodId })
        .onConflict((conflict) => conflict.constraint('inventories_unique').doNothing())
        .execute();
    }
    const inventories = await trx
      .selectFrom('game.inventories')
      .select(['id', 'good_id', 'quantity', 'reserved'])
      .where('house_id', '=', place.house_id)
      .where('city_id', '=', place.city_id)
      .where('good_id', 'in', goods)
      .orderBy('good_id')
      .forUpdate()
      .execute();
    const inventoryOf = (goodId: string) =>
      inventories.find((inventory) => inventory.good_id === goodId);

    // Un atelier ne tourne que sur le stock libre : ce qui est réservé par des ventes n'est pas consommé.
    const { cycles, elapsedCycles, since } = accrueWorkshop({
      since: site.cycle_started_at,
      now,
      cycleMinutes: recipe.durationMinutes,
      maxCycles: recipe.maxAccruedCycles,
      inputs: recipe.inputs.map((stack) => {
        const inventory = inventoryOf(stack.goodId);
        const free = inventory ? Number(inventory.quantity) - Number(inventory.reserved) : 0;
        return { perCycle: stack.quantity, available: free };
      }),
    });
    if (elapsedCycles === 0) {
      const message = 'No full production cycle has elapsed yet.';
      return { ok: false, error: { code: 'NOTHING_TO_COLLECT', message } };
    }
    if (cycles === 0) {
      const message = 'Not enough free stock of the inputs to run a single cycle.';
      return { ok: false, error: { code: 'MISSING_INPUTS', message } };
    }

    const scaled = (stacks: typeof recipe.inputs) =>
      stacks
        .map((stack) => ({ goodId: stack.goodId, quantity: cycles * stack.quantity }))
        .sort((a, b) => (a.goodId < b.goodId ? -1 : 1));
    const [inputs, outputs] = [scaled(recipe.inputs), scaled(recipe.outputs)];
    const movement = { world_id: site.world_id, kind: 'site.collect' };
    // Intrants sortis puis extrants entrés, dans la même transaction, par le journal des stocks.
    for (const { goodId, quantity } of inputs) {
      const inventory = inventoryOf(goodId);
      if (!inventory) throw new Error(`Input ${goodId} counted without an inventory`);
      await trx
        .insertInto('game.stock_ledger')
        .values({
          ...movement,
          good_id: goodId,
          quantity,
          from_inventory_id: inventory.id,
          to_system: 'production',
        })
        .execute();
    }
    for (const { goodId, quantity } of outputs) {
      const inventory = inventoryOf(goodId);
      if (!inventory) throw new Error(`Output ${goodId} has no inventory`);
      await trx
        .insertInto('game.stock_ledger')
        .values({
          ...movement,
          good_id: goodId,
          quantity,
          from_system: 'production',
          to_inventory_id: inventory.id,
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
      payload: { siteId: site.id, houseId: site.house_id, cycles, inputs, outputs },
    });
    return {
      ok: true,
      data: { siteId: site.id, cycles, inputs, outputs, cycleStartedAt: since.toISOString() },
    };
  },
});

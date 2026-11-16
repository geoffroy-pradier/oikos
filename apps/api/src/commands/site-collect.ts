import {
  SITE_COLLECT_ERROR_CODES,
  siteCollectInputSchema,
  siteCollectOutputSchema,
} from '@oikos/contracts';
import {
  accrueProduction,
  accrueWorkshop,
  cycleYield,
  yieldDeltaBps,
  yieldModelOf,
} from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand } from '../registry';

/**
 * Récolte un site : la production est calculée ici, à partir de l'horodatage du cycle en cours
 * (évaluation paresseuse). Un atelier consomme ses intrants dans le stock libre de la maison ; à court
 * d'intrants, les cycles en attente restent dus (docs/specs/04-systemes-gestion.md, 4.3). Tout passe
 * par le journal des stocks. Un site à l'arrêt, faute d'entretien payé, ne compte le temps que jusqu'à
 * son arrêt. Un site dont la recette a quitté la configuration ne se récolte plus.
 *
 * Un cycle terminé pendant un événement de rendement de sa cité (sécheresse des champs, bonne année des vergers ;
 * 7.4, #267) produit selon `cycleYield` ; l'écart de chaque événement est expliqué dans `event_effects`. Les
 * événements sont lus sans verrou : ils ne changent jamais, et commencent après leur planification.
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
      .select([
        'id',
        'world_id',
        'house_id',
        'city_id',
        'recipe_id',
        'cycle_started_at',
        'halted_at',
      ])
      .where('id', '=', input.siteId)
      .where('house_id', 'in', (houses) =>
        houses.selectFrom('game.houses').select('id').where('user_id', '=', userId),
      )
      .forUpdate()
      .executeTakeFirst();
    // Le site d'un autre joueur est indiscernable d'un site inexistant.
    if (!site) return { ok: false, error: { code: 'SITE_NOT_FOUND', message: 'Unknown site.' } };

    // Une recette retirée de la configuration ne se calcule plus : le site ne se récolte plus, à
    // l'arrêt ou non. Ce qu'il avait accumulé est gelé tant que la recette manque : changer de recette
    // le perd, une version qui rend la recette le rend (4.2).
    const recipe = config.recipes.find((candidate) => candidate.id === site.recipe_id);
    if (!recipe) {
      const message = 'This site runs a recipe the configuration no longer has.';
      return { ok: false, error: { code: 'RECIPE_RETIRED', message } };
    }

    // Un site à l'arrêt ne consomme aucun intrant (4.3) : un atelier à l'arrêt ne se récolte pas. Ses
    // cycles écoulés avant l'arrêt restent dus et tourneront après la relance.
    if (site.halted_at && recipe.inputs.length > 0) {
      const message = 'This workshop is halted until its upkeep is paid.';
      return { ok: false, error: { code: 'SITE_HALTED', message } };
    }
    // Un site à l'arrêt ne produit pas (5.5) : pour lui, le temps s'est arrêté à l'instant de l'arrêt.
    // Ce qu'il avait accumulé avant reste récoltable ; le cycle entamé est gelé jusqu'à la reprise.
    const until = site.halted_at && site.halted_at < now ? site.halted_at : now;
    // Le cas le plus fréquent d'abord, sans toucher à aucun stock : aucun cycle n'est écoulé.
    const byTime = accrueProduction({
      since: site.cycle_started_at,
      now: until,
      cycleMinutes: recipe.durationMinutes,
      outputPerCycle: 1,
      maxCycles: recipe.maxAccruedCycles,
    });
    if (byTime.cycles === 0) {
      const message = 'No full production cycle has elapsed yet.';
      return { ok: false, error: { code: 'NOTHING_TO_COLLECT', message } };
    }

    // Stocks touchés, intrants et extrants confondus, ouverts puis verrouillés dans l'ordre des biens
    // (celui des unités de code, le même en JavaScript et en base avec le classement "C") : deux récoltes
    // de la même maison, une récolte et une vente ne s'interbloquent pas. Une récolte et un tick le
    // peuvent : le tick verrouille les stocks vendus aux PNJ dans l'ordre des prix, puis les stocks
    // d'arrivée des voyages (#253). PostgreSQL annule alors l'une des deux en entier, sans double effet ;
    // la récolte se renvoie sous la même clé, le tick est rejoué au passage suivant. Un nouvel essai
    // automatique est prévu par un ticket à venir.
    const goods = [...new Set([...recipe.inputs, ...recipe.outputs].map((stack) => stack.goodId))];
    goods.sort();
    const produced = new Set(recipe.outputs.map((stack) => stack.goodId));
    const place = { house_id: site.house_id, city_id: site.city_id };
    // Un extrant jamais produit n'a pas encore de stock : il est ouvert, vide.
    for (const goodId of goods.filter((candidate) => produced.has(candidate))) {
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
      .orderBy(sql`good_id collate "C"`)
      .forUpdate()
      .execute();
    const inventoryOf = (goodId: string) =>
      inventories.find((inventory) => inventory.good_id === goodId);

    // Un atelier ne tourne que sur le stock libre : ce qui est réservé par des ventes n'est pas consommé.
    const { cycles, since } = accrueWorkshop({
      since: site.cycle_started_at,
      now: until,
      cycleMinutes: recipe.durationMinutes,
      maxCycles: recipe.maxAccruedCycles,
      inputs: recipe.inputs.map((stack) => {
        const inventory = inventoryOf(stack.goodId);
        const free = inventory ? Number(inventory.quantity) - Number(inventory.reserved) : 0;
        return { perCycle: stack.quantity, available: free };
      }),
    });
    if (cycles === 0) {
      const message = 'Not enough free stock of the inputs to run a single cycle.';
      return { ok: false, error: { code: 'MISSING_INPUTS', message } };
    }

    const scaled = (stacks: typeof recipe.inputs) =>
      stacks
        .map((stack) => ({ goodId: stack.goodId, quantity: cycles * stack.quantity }))
        .sort((a, b) => (a.goodId < b.goodId ? -1 : 1));
    // Les cycles récoltés sont les premiers après `cycle_started_at`, terminés au plus tard à `until`.
    const model = yieldModelOf(recipe.siteType);
    const events =
      model === undefined
        ? []
        : await trx
            .selectFrom('game.world_events')
            .select(['id', 'starts_at', 'ends_at', 'magnitude_bps'])
            .where('city_id', '=', site.city_id)
            .where('model', '=', model)
            .where('ends_at', '>', site.cycle_started_at)
            .where('starts_at', '<=', until)
            .execute();
    const effects = events.map((event) => ({
      eventId: event.id,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      deltaBps: model === undefined ? 0 : yieldDeltaBps(model, event.magnitude_bps),
    }));
    const gaps: { eventId: string; goodId: string; quantity: number }[] = [];
    const inputs = scaled(recipe.inputs);
    const outputs = scaled(recipe.outputs).map(({ goodId }) => {
      const perCycle = recipe.outputs.find((stack) => stack.goodId === goodId)?.quantity ?? 0;
      const { quantity, byEvent } = cycleYield({
        since: site.cycle_started_at,
        cycleMinutes: recipe.durationMinutes,
        cycles,
        outputPerCycle: perCycle,
        effects,
      });
      for (const [eventId, gap] of byEvent) gaps.push({ eventId, goodId, quantity: gap });
      return { goodId, quantity };
    });
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
    // Un rendement nul (sécheresse au plus fort) n'a pas de mouvement.
    for (const { goodId, quantity } of outputs.filter((stack) => stack.quantity > 0)) {
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

    if (gaps.length > 0)
      await trx
        .insertInto('game.event_effects')
        .values(
          gaps.map((gap) => ({
            world_id: site.world_id,
            event_id: gap.eventId,
            kind: 'site_yield',
            site_id: site.id,
            good_id: gap.goodId,
            quantity: gap.quantity,
          })),
        )
        .execute();

    emit({
      type: 'SiteCollected',
      payload: {
        siteId: site.id,
        houseId: site.house_id,
        cycles,
        inputs,
        outputs,
        ...(gaps.length > 0 && { eventEffects: gaps }),
      },
    });
    return {
      ok: true,
      data: { siteId: site.id, cycles, inputs, outputs, cycleStartedAt: since.toISOString() },
    };
  },
});

import {
  SHIP_ACQUIRE_ERROR_CODES,
  shipAcquireInputSchema,
  shipAcquireOutputSchema,
} from '@oikos/contracts';
import { cityHasPort } from '@oikos/config';
import { defineCommand, type CommandResult } from '../registry';
import { accountHouseId } from '@oikos/operations';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * La maison achète un navire neuf (docs/specs/04-systemes-gestion.md, 4.6). Il naît à quai dans le port
 * de sa cité, armé. Son prix, fixé par la configuration pour sa classe, est détruit (puits
 * `sink_ship_purchase`) ; un autre prix que celui que le joueur a vu est refusé, pas prélevé.
 */
export const shipAcquire = defineCommand({
  name: 'ship.acquire',
  input: shipAcquireInputSchema,
  output: shipAcquireOutputSchema,
  errors: SHIP_ACQUIRE_ERROR_CODES,
  // La base fait foi sous concurrence : le compte d'une maison ne passe jamais sous zéro.
  errorByConstraint: {
    accounts_no_overdraft: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' },
  },
  async handler({ trx, userId, emit, config }, input) {
    const house = await trx
      .selectFrom('game.houses')
      .select(['id', 'world_id'])
      .where('id', '=', accountHouseId(userId))
      .executeTakeFirst();
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const shipClass = config.ships.classes.find((candidate) => candidate.id === input.classId);
    if (!shipClass) return refuse('SHIP_CLASS_NOT_FOUND', 'Unknown ship class.');
    const citizenship = await trx
      .selectFrom('game.citizenships as c')
      .innerJoin('game.cities as city', 'city.id', 'c.city_id')
      .select(['c.city_id', 'city.slug'])
      .where('c.house_id', '=', house.id)
      .executeTakeFirstOrThrow();
    const city = config.cities.find((candidate) => candidate.id === citizenship.slug);
    if (!cityHasPort(city)) return refuse('NO_PORT', 'This city has no port.');

    const costOboles = shipClass.purchaseCostOboles;
    // Le prix affiché fait foi : un autre tarif (configuration activée entre-temps) n'est pas prélevé.
    if (input.expectedCostOboles !== costOboles)
      return refuse('PRICE_CHANGED', `This ship now costs ${costOboles} oboles.`);
    // Verrou du compte : deux achats simultanés se suivent, le second voit le solde du premier. Pas de
    // verrou de la maison, que rien ne borne ici (pas de limite de flotte) : l'ordre compte puis maison
    // (clé étrangère du navire) est celui d'un achat à l'agora, sans interblocage avec `site.acquire`.
    const account = await trx
      .selectFrom('game.accounts')
      .select(['id', 'balance'])
      .where('house_id', '=', house.id)
      .where('kind', '=', 'house')
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (Number(account.balance) < costOboles)
      return refuse('INSUFFICIENT_FUNDS', 'Not enough money.');
    const sink = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', house.world_id)
      .where('system_key', '=', 'sink_ship_purchase')
      .executeTakeFirstOrThrow();

    const ship = await trx
      .insertInto('game.ships')
      .values({
        world_id: house.world_id,
        house_id: house.id,
        class_id: shipClass.id,
        docked_city_id: citizenship.city_id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({
        world_id: house.world_id,
        kind: 'ship.acquire',
        meta: JSON.stringify({ houseId: house.id, shipId: ship.id }),
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
      type: 'ShipAcquired',
      payload: {
        shipId: ship.id,
        houseId: house.id,
        cityId: citizenship.city_id,
        classId: shipClass.id,
        costOboles,
      },
    });
    return {
      ok: true,
      data: {
        shipId: ship.id,
        classId: shipClass.id,
        dockedCityId: citizenship.city_id,
        costOboles,
      },
    };
  },
});

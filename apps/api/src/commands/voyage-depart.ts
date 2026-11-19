import { portDuesBaseOboles, routeProvisionsOboles, shipRoute } from '@oikos/config';
import {
  VOYAGE_DEPART_ERROR_CODES,
  voyageDepartInputSchema,
  voyageDepartOutputSchema,
} from '@oikos/contracts';
import { cityRatesOf } from '@oikos/db';
import {
  cargoUnits,
  departureCost,
  fairWindSeconds,
  graceToConsume,
  stormDurationSeconds,
  voyageDurationSeconds,
} from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';
import { accountHouseId } from '@oikos/operations';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});
const NO_STOCK = { code: 'INSUFFICIENT_STOCK', message: 'Not enough free stock to load.' };

/**
 * Un navire part d'une cité vers une autre (4.6) : sa cargaison sort du stock libre de la maison vers
 * l'extrémité `in_transit`, rattachée au voyage ; la maison paie les provisions (puits) et le droit de port
 * de la cité d'arrivée (5.6 : coefficient de cette cité, part détruite, reste au trésor de la cité) dans une écriture
 * `voyage.departure`. L'arrivée est jouée par le moteur (#253). Un autre coût que le coût vu est refusé.
 * Un départ pendant une tempête de sa route (7.4, #267) allonge le trajet de l'ampleur de la plus forte (à égalité,
 * le plus petit identifiant, soit la planification la plus ancienne), sans rien faire perdre ; le retard est
 * expliqué dans `event_effects`. Les événements sont lus sans verrou : ils ne changent jamais, et commencent
 * après leur planification.
 * Un vent favorable en attente de la maison (7.1, #266), le plus ancien, raccourcit ensuite le trajet
 * (`fairWindSeconds`, sur la durée que la tempête a fixée) et se consomme ; s'il ne retire pas une seconde, il reste
 * en attente. Les grâces en attente sont verrouillées en dernier, après les stocks, comme par une récolte.
 */
export const voyageDepart = defineCommand({
  name: 'voyage.depart',
  input: voyageDepartInputSchema,
  output: voyageDepartOutputSchema,
  errors: VOYAGE_DEPART_ERROR_CODES,
  // La base fait foi sous concurrence : ni découvert, ni stock réservé emporté, ni second voyage en mer.
  errorByConstraint: {
    accounts_no_overdraft: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' },
    inventories_reserved_within_quantity: NO_STOCK,
    inventories_quantity_check: NO_STOCK,
    voyages_one_at_sea_idx: { code: 'SHIP_AT_SEA', message: 'This ship is at sea.' },
  },
  async handler({ trx, userId, emit, config }, input) {
    const owned = await trx
      .selectFrom('game.ships')
      .select(['id', 'world_id', 'house_id', 'class_id'])
      .where('id', '=', input.shipId)
      .where('house_id', '=', accountHouseId(userId))
      .executeTakeFirst();
    // Le navire d'un autre joueur est indiscernable d'un navire inexistant.
    if (!owned) return refuse('SHIP_NOT_FOUND', 'Unknown ship.');
    const cities = await trx
      .selectFrom('game.cities')
      .select(['id', 'slug'])
      .where('world_id', '=', owned.world_id)
      .where('id', 'in', [input.fromCityId, input.toCityId])
      .execute();
    const slugOf = (cityId: string) => cities.find((city) => city.id === cityId)?.slug;
    const toSlug = slugOf(input.toCityId);
    if (toSlug === undefined) return refuse('CITY_NOT_FOUND', 'Unknown city.');
    if (input.cargo.some((line) => !config.goods.some((good) => good.id === line.goodId)))
      return refuse('GOOD_NOT_FOUND', 'Unknown good.');

    // Ordre des verrous : l'agora du monde (ses échanges touchent stocks et trésoreries de plusieurs
    // maisons), la trésorerie, le navire, puis les stocks dans l'ordre des biens. La clôture prend le même
    // verrou d'agora d'abord : un départ ne s'intercale pas dans son prélèvement. `ship.acquire` et
    // `site.restart` ne verrouillent rien après la trésorerie que ce départ tienne avant elle.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${owned.world_id}`}, 0))`.execute(
      trx,
    );
    const account = await trx
      .selectFrom('game.accounts')
      .select(['id', 'balance'])
      .where('house_id', '=', owned.house_id)
      .where('kind', '=', 'house')
      .forUpdate()
      .executeTakeFirstOrThrow();
    const ship = await trx
      .selectFrom('game.ships')
      .select(['docked_city_id', 'laid_up_at'])
      .where('id', '=', owned.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (ship.docked_city_id === null) return refuse('SHIP_AT_SEA', 'This ship is at sea.');
    if (ship.docked_city_id !== input.fromCityId)
      return refuse('SHIP_NOT_IN_CITY', 'This ship is docked in another city.');
    if (ship.laid_up_at !== null)
      return refuse('SHIP_LAID_UP', 'This ship is laid up until its upkeep is paid.');

    const shipClass = config.ships.classes.find((candidate) => candidate.id === owned.class_id);
    if (!shipClass) return refuse('SHIP_CLASS_RETIRED', 'This ship class is no longer in service.');
    const fromSlug = slugOf(input.fromCityId) ?? '';
    const route = shipRoute(config, fromSlug, toSlug);
    if (!route) return refuse('NO_ROUTE', 'No sea route links these cities.');
    if (cargoUnits(input.cargo) > shipClass.capacityUnits)
      return refuse('CARGO_OVER_CAPACITY', `This ship carries ${shipClass.capacityUnits} units.`);
    // Coefficient de la cité d'arrivée (5.6) : dernier décret appliqué, sinon la configuration, lu sous le
    // verrou de l'agora, que prend aussi la clôture qui applique un décret.
    const arrival = await cityRatesOf(trx, owned.world_id, input.toCityId, config);
    const cost = departureCost({
      provisionsOboles: routeProvisionsOboles(route, shipClass.id),
      portDuesBaseOboles: portDuesBaseOboles(config, shipClass.id),
      cityCoefficientBps: arrival.portDuesCoefficientBps,
      burnShareBps: config.ships.portDues.burnShareBps,
    });
    // Le coût affiché fait foi : un autre tarif (configuration activée entre-temps) n'est pas prélevé.
    if (input.expectedCostOboles !== cost.totalOboles)
      return refuse('PRICE_CHANGED', `This voyage now costs ${cost.totalOboles} oboles.`);

    // Stocks de la cargaison, verrouillés dans l'ordre des biens (classement "C"), comme une récolte : le
    // stock libre exclut ce que réservent les ventes en attente.
    const goods = input.cargo.map((line) => line.goodId).sort();
    const stocks =
      goods.length === 0
        ? []
        : await trx
            .selectFrom('game.inventories')
            .select(['id', 'good_id', 'quantity', 'reserved'])
            .where('house_id', '=', owned.house_id)
            .where('city_id', '=', input.fromCityId)
            .where('good_id', 'in', goods)
            .orderBy(sql`good_id collate "C"`)
            .forUpdate()
            .execute();
    const stockOf = (goodId: string) => stocks.find((stock) => stock.good_id === goodId);
    for (const line of input.cargo) {
      const stock = stockOf(line.goodId);
      if (!stock || Number(stock.quantity) - Number(stock.reserved) < line.quantity)
        return refuse(NO_STOCK.code, NO_STOCK.message);
    }
    if (Number(account.balance) < cost.totalOboles)
      return refuse('INSUFFICIENT_FUNDS', 'Not enough money.');

    // L'arrivée prévue est comptée sur l'horloge de la base, celle du départ (`now()`).
    const storm = await trx
      .selectFrom('game.world_events')
      .select(['id', 'magnitude_bps'])
      .where('model', '=', 'storm')
      .where((eb) =>
        eb.or([
          eb.and([eb('city_id', '=', input.fromCityId), eb('other_city_id', '=', input.toCityId)]),
          eb.and([eb('city_id', '=', input.toCityId), eb('other_city_id', '=', input.fromCityId)]),
        ]),
      )
      .where('starts_at', '<=', sql<Date>`now()`)
      .where('ends_at', '>', sql<Date>`now()`)
      .orderBy('magnitude_bps', 'desc')
      .orderBy('id')
      .limit(1)
      .executeTakeFirst();
    const calm = voyageDurationSeconds(route.hours, shipClass.speedBps);
    const stormy = storm ? stormDurationSeconds(calm, storm.magnitude_bps) : calm;
    const pending = await trx
      .selectFrom('game.graces_used')
      .select(['id', 'grace_id', 'magnitude_bps', 'invoked_at'])
      .where('house_id', '=', owned.house_id)
      .where('effect', '=', 'fair_wind')
      .where('consumed_at', 'is', null)
      .orderBy('invoked_at')
      .orderBy('id')
      .forUpdate()
      .execute();
    const wind = graceToConsume(
      pending.map((row) => ({ ...row, effect: 'fair_wind', invokedAt: row.invoked_at })),
      'fair_wind',
      (candidate) => fairWindSeconds(stormy, candidate.magnitude_bps) < stormy,
    );
    const seconds = wind ? fairWindSeconds(stormy, wind.magnitude_bps) : stormy;
    const voyage = await trx
      .insertInto('game.voyages')
      .values({
        world_id: owned.world_id,
        house_id: owned.house_id,
        ship_id: owned.id,
        from_city_id: input.fromCityId,
        to_city_id: input.toCityId,
        arrives_at: sql<Date>`now() + ${seconds} * interval '1 second'`,
      })
      .returning(['id', 'departed_at', 'arrives_at'])
      .executeTakeFirstOrThrow();
    if (input.cargo.length > 0) {
      await trx
        .insertInto('game.voyage_cargo')
        .values(
          input.cargo.map((line) => ({
            voyage_id: voyage.id,
            world_id: owned.world_id,
            good_id: line.goodId,
            quantity: line.quantity,
          })),
        )
        .execute();
      await trx
        .insertInto('game.stock_ledger')
        .values(
          input.cargo.map((line) => ({
            world_id: owned.world_id,
            good_id: line.goodId,
            quantity: line.quantity,
            from_inventory_id: stockOf(line.goodId)?.id ?? null,
            to_system: 'in_transit',
            kind: 'voyage.departure',
            voyage_id: voyage.id,
          })),
        )
        .execute();
    }
    await trx
      .updateTable('game.ships')
      .set({ docked_city_id: null })
      .where('id', '=', owned.id)
      .execute();
    const fairWind = wind && {
      graceUseId: wind.id,
      graceId: wind.grace_id,
      savedSeconds: stormy - seconds,
    };
    if (fairWind)
      await trx
        .updateTable('game.graces_used')
        .set({
          consumed_at: sql<Date>`now()`,
          voyage_id: voyage.id,
          saved_seconds: fairWind.savedSeconds,
        })
        .where('id', '=', fairWind.graceUseId)
        .execute();
    const delaySeconds = stormy - calm;
    if (storm && delaySeconds > 0)
      await trx
        .insertInto('game.event_effects')
        .values({
          world_id: owned.world_id,
          event_id: storm.id,
          kind: 'voyage_delay',
          voyage_id: voyage.id,
          delay_seconds: delaySeconds,
        })
        .execute();

    const dues = cost.portDues;
    if (cost.totalOboles > 0) {
      // Un compte manquant est une erreur de la base, pas un refus : elle le nomme.
      const accountOf = (column: 'system_key' | 'city_id', value: string) =>
        trx
          .selectFrom('game.accounts')
          .select('id')
          .where('world_id', '=', owned.world_id)
          .where(column, '=', value)
          .executeTakeFirstOrThrow(
            () => new Error(`World ${owned.world_id} has no account with ${column} ${value}`),
          );
      const provisions = (await accountOf('system_key', 'sink_voyage_provisions')).id;
      const portDues = (await accountOf('system_key', 'sink_port_dues')).id;
      const cityTreasury = (await accountOf('city_id', input.toCityId)).id;
      const entry = await trx
        .insertInto('game.ledger_entries')
        .values({
          world_id: owned.world_id,
          kind: 'voyage.departure',
          meta: JSON.stringify({
            houseId: owned.house_id,
            shipId: owned.id,
            voyageId: voyage.id,
            provisionsOboles: cost.provisionsOboles,
            portDues: dues,
          }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // Une ligne de débit de la trésorerie par paiement, chacune vers ses comptes ; une part nulle n'a
      // pas de ligne. L'écriture est équilibrée.
      const lines: [string, number][] = [
        [account.id, -cost.provisionsOboles],
        [provisions, cost.provisionsOboles],
        [account.id, -dues.oboles],
        [portDues, dues.burned],
        [cityTreasury, dues.treasury],
      ];
      await trx
        .insertInto('game.ledger_lines')
        .values(
          lines
            .filter(([, amount]) => amount !== 0)
            .map(([account_id, amount]) => ({ entry_id: entry.id, account_id, amount })),
        )
        .execute();
    }

    const departure = {
      voyageId: voyage.id,
      shipId: owned.id,
      fromCityId: input.fromCityId,
      toCityId: input.toCityId,
      departedAt: voyage.departed_at.toISOString(),
      arrivesAt: voyage.arrives_at.toISOString(),
      cargo: input.cargo,
      provisionsOboles: cost.provisionsOboles,
    };
    emit({
      type: 'VoyageDeparted',
      payload: {
        ...departure,
        houseId: owned.house_id,
        portDues: dues,
        ...(storm && delaySeconds > 0 && { storm: { eventId: storm.id, delaySeconds } }),
        ...(fairWind && { fairWind }),
      },
    });
    return {
      ok: true,
      data: {
        ...departure,
        portDuesOboles: dues.oboles,
        costOboles: cost.totalOboles,
        ...(fairWind && { fairWind }),
      },
    };
  },
});

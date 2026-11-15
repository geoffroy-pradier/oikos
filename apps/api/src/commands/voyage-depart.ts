import {
  cityPortDuesCoefficientBps,
  portDuesBaseOboles,
  routeProvisionsOboles,
  shipRoute,
} from '@oikos/config';
import {
  VOYAGE_DEPART_ERROR_CODES,
  voyageDepartInputSchema,
  voyageDepartOutputSchema,
} from '@oikos/contracts';
import { cargoUnits, departureCost, voyageDurationSeconds } from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});
const NO_STOCK = { code: 'INSUFFICIENT_STOCK', message: 'Not enough free stock to load.' };

/**
 * Un navire part d'une cité vers une autre (4.6) : sa cargaison sort du stock libre de la maison vers
 * l'extrémité `in_transit`, rattachée au voyage ; la maison paie les provisions (puits) et le droit de port
 * de la cité d'arrivée (5.6 : part détruite, reste au trésor de la cité) dans une écriture
 * `voyage.departure`. L'arrivée est jouée par le moteur (#253). Un autre coût que le coût vu est refusé.
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
      .where('house_id', 'in', (houses) =>
        houses.selectFrom('game.houses').select('id').where('user_id', '=', userId),
      )
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
    const cost = departureCost({
      provisionsOboles: routeProvisionsOboles(route, shipClass.id),
      portDuesBaseOboles: portDuesBaseOboles(config, shipClass.id),
      cityCoefficientBps: cityPortDuesCoefficientBps(config, toSlug),
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
    const seconds = voyageDurationSeconds(route.hours, shipClass.speedBps);
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
      payload: { ...departure, houseId: owned.house_id, portDues: dues },
    });
    return {
      ok: true,
      data: { ...departure, portDuesOboles: dues.oboles, costOboles: cost.totalOboles },
    };
  },
});

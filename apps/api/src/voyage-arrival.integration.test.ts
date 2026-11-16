import { randomUUID } from 'node:crypto';
import { voyageArrivals } from '@oikos/engine';
import { createRng, marketTax, tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_CONFIG } from './test-config';
import {
  app,
  balanceOf,
  db,
  depart,
  ELAIA,
  newShipowner,
  owner,
  send,
  shipOf,
  stockOf,
  voyagesOf,
  WORLD,
} from './voyage.integration-fixtures';

// De bout en bout (#253) : départ par la commande, arrivée par l'étape du moteur, vente à l'agora d'arrivée.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const { tickMinutes } = TEST_CONFIG.config.clock;

/** Le moteur joue l'étape d'arrivée du tick de l'instant `tick`. */
const arrive = (tick: Date) =>
  db.transaction().execute((trx) =>
    voyageArrivals.run({
      trx,
      worldId: WORLD,
      index: tickIndexAt(tick, tickMinutes),
      scheduledAt: tick,
      config: TEST_CONFIG.config,
      rng: createRng('0'),
      dailyClose: false,
      seasonSwitch: false,
      catchUp: false,
    }),
  );

/** Le temps passe : départ et échéance du voyage sont antidatés (garde des voyages levée le temps de les réécrire). */
async function backdate(voyageId: string, arrivesAt: Date) {
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.voyages disable trigger voyages_guard, disable trigger voyages_settled`.execute(
      trx,
    );
    await sql`update game.voyages set departed_at = ${arrivesAt}::timestamptz - interval '4 hours',
      arrives_at = ${arrivesAt} where id = ${voyageId}`.execute(trx);
    await sql`alter table game.voyages enable trigger voyages_guard, enable trigger voyages_settled`.execute(
      trx,
    );
  });
}
/** Début du tick en cours, à au moins `margin` millisecondes de sa fin (attend le suivant sinon). */
async function currentTick(margin = 0) {
  const tickMs = tickMinutes * 60_000;
  const left = tickMs - (Date.now() % tickMs);
  if (left < margin) await new Promise((resolve) => setTimeout(resolve, left + 10));
  return tickStart(tickIndexAt(new Date(), tickMinutes), tickMinutes);
}
/** Un voyage de Kallistè vers Elaia, parti par la commande, qui échoit à `arrivesAt`. */
async function voyageDueAt(arrivesAt: Date) {
  const player = await newShipowner();
  const departed = await depart(player);
  await backdate(departed.body.data.voyageId as string, arrivesAt);
  return player;
}

describe('arrivée d’un voyage, de bout en bout', () => {
  it('la cargaison partie de Kallistè se vend à l’agora d’Elaia dès son déchargement', async () => {
    const seller = await newShipowner();
    const buyer = await newShipowner(ELAIA);
    const sell = { cityId: ELAIA, goodId: 'wheat', side: 'sell', price: 7, quantity: 30 };
    const departed = await depart(seller);
    expect(departed.body.ok).toBe(true);
    const voyageId = departed.body.data.voyageId as string;

    // En mer, la cargaison n'est à vendre nulle part.
    expect((await send(seller.user, 'market.placeOrder', sell)).body.error?.code).toBe(
      'INSUFFICIENT_STOCK',
    );

    const tick = await currentTick();
    await backdate(voyageId, tick);
    await arrive(tick);
    expect(await voyagesOf(seller.shipId)).toMatchObject([{ arrived_at: tick }]);
    expect(await shipOf(seller.shipId)).toEqual({ docked_city_id: ELAIA, laid_up_at: null });
    expect([
      await stockOf(seller.houseId, 'wheat'),
      await stockOf(seller.houseId, 'wheat', ELAIA),
    ]).toEqual([70, 30]);

    // Déchargée, elle est dans le stock libre de la maison à Elaia : mise en vente, puis achetée.
    const placed = await send(seller.user, 'market.placeOrder', sell);
    expect(placed.body.data).toMatchObject({ status: 'open', remaining: 30, trades: [] });
    const before = await balanceOf({ houseId: seller.houseId });
    const bought = await send(buyer.user, 'market.placeOrder', { ...sell, side: 'buy' });
    expect(bought.body.data).toMatchObject({
      status: 'filled',
      trades: [{ price: 7, quantity: 30 }],
    });
    expect(await stockOf(seller.houseId, 'wheat', ELAIA)).toBe(0);
    expect(await stockOf(buyer.houseId, 'wheat', ELAIA)).toBe(130);
    expect(await balanceOf({ houseId: seller.houseId })).toBe(
      before + marketTax(7 * 30, TEST_CONFIG.config.marketTax).net,
    );
    // Rien n'est déchargé deux fois : un second passage de l'étape ne retrouve pas ce voyage.
    await arrive(tick);
    expect(await stockOf(seller.houseId, 'wheat', ELAIA)).toBe(0);
    const events = await owner
      .selectFrom('game.domain_events')
      .select('payload')
      .where('type', '=', 'VoyageArrived')
      .where(sql<boolean>`payload->>'voyageId' = ${voyageId}`)
      .execute();
    expect(events.map((event) => event.payload)).toMatchObject([
      { houseId: seller.houseId, toCityId: ELAIA, cargo: [{ goodId: 'wheat', quantity: 30 }] },
    ]);
  });

  it('la Vigie compte les voyages en retard de déchargement de plus d’un tick', async () => {
    const admin = randomUUID();
    await sql`insert into auth.users (id, email) values (${admin}, ${`${admin}@example.test`})`.execute(
      owner,
    );
    await sql`insert into admin.roles (user_id, role) values (${admin}, 'super_admin')`.execute(
      owner,
    );
    const overdue = async () => {
      const reply = await app.request('/api/admin/vigie', {
        headers: { authorization: `Bearer aal2:${admin}` },
      });
      return ((await reply.json()) as { data: { voyagesOverdue: number } }).data.voyagesOverdue;
    };
    // Base partagée avec les autres suites : le compte est vérifié par différence.
    const tick = await currentTick(10_000);
    const before = await overdue();
    const at = (ticksBack: number, ms = 0) =>
      new Date(tick.getTime() - ticksBack * tickMinutes * 60_000 + ms);
    // Échu au début du tick précédent : ce tick est terminé, le voyage est en retard. Une milliseconde
    // plus tard, c'est le tick en cours qui doit le décharger : pas encore en retard.
    const late = [await voyageDueAt(at(1)), await voyageDueAt(at(3, 1))];
    const onTime = [await voyageDueAt(at(1, 1)), await voyageDueAt(at(0))];
    expect(await overdue()).toBe(before + 2);
    await arrive(tick);
    for (const player of [...late, ...onTime])
      expect(await shipOf(player.shipId)).toMatchObject({ docked_city_id: ELAIA });
    expect(await overdue()).toBe(before);
  });
});

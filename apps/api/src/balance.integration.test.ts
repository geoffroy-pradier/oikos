import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  closeDay,
  closeOf,
  config,
  createCity,
  foundHouses,
  harvest,
  MINUTE,
  openBench,
  reconcile,
  referenceOf,
  tickDay,
  upkeepDue,
} from './balance/city';

/*
 * Équilibrage de la cité prototype (ticket #78, docs/specs/05-economie.md 5.2 et 5.5), première mesure
 * dans un monde à part : quelques jours de récolte, de demande des PNJ et de clôtures, joués à leur heure
 * de jeu (`balance/city.ts`). Des maisons scriptées vendent leur blé au prix de référence.
 */
const bench = openBench();
beforeAll(() => bench.start());
afterAll(() => bench.stop());

const DAYS = 3;

it('3 jours : tous les ticks du jour, grand livre rapproché', { timeout: 120_000 }, async () => {
  const city = await createCity(bench, DAYS);
  const houses = await foundHouses(city, 4);
  let upkeep = 0;
  for (let day = 0; day < DAYS; day++) {
    upkeep += upkeepDue(city, houses, day);
    await closeDay(city, day);
    const now = new Date(closeOf(city, day).getTime() + MINUTE);
    for (const house of houses) {
      await harvest(city, house, now);
      const quantity = house.produced.get('wheat') ?? 0;
      if (quantity > 0) {
        const placed = await city.send(house.user, 'market.placeOrder', {
          cityId: city.cityId,
          goodId: 'wheat',
          side: 'sell',
          price: referenceOf('wheat'),
          quantity,
        });
        expect(placed.ok).toBe(true);
      }
    }
    // Du tick de la clôture à la clôture suivante, tous les ticks du jour (144 hors changement d'heure).
    const length = closeOf(city, day + 1).getTime() - closeOf(city, day).getTime();
    expect(await tickDay(city, day)).toBe(length / (config.clock.tickMinutes * MINUTE));
  }

  // Robinets, puits et trésor de la cité rapprochés des flux comptés ; puis la masse en circulation.
  const ledger = await reconcile(city, houses.length, { sink_upkeep: upkeep });
  expect(ledger.actual).toEqual(ledger.expected);
  expect(ledger.supply).toBe(ledger.mass);
  // Des PNJ ont acheté du blé, taxé ; l'entretien a été prélevé.
  expect(ledger.expected['faucet_npc_purchases']).toBeLessThan(0);
  expect(ledger.expected['sink_market_tax']).toBeGreaterThan(0);
  expect(upkeep).toBeGreaterThan(0);
});

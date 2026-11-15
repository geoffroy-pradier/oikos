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
import { morning, ROLES, seller } from './balance/strategy';

/*
 * Équilibrage de la cité prototype (ticket #78, docs/specs/05-economie.md 5.2 et 5.5), dans un monde à
 * part : récolte, demande des PNJ et clôtures, joués à leur heure de jeu (`balance/city.ts`). D'abord
 * trois jours où des maisons vendent leur blé au prix de référence ; puis une semaine de mise en route
 * et 30 jours mesurés, avec la configuration initiale. Les maisons scriptées acquièrent leurs sites,
 * achètent leurs intrants et vendent leur production par les vraies commandes (`balance/strategy.ts`) ;
 * la demande des PNJ et la clôture quotidienne (population, entretien) sont celles du moteur.
 */
const bench = openBench();
beforeAll(() => bench.start());
afterAll(() => bench.stop());

const DAYS = 3;

it('3 jours : tous les ticks du jour, grand livre rapproché', { timeout: 120_000 }, async () => {
  const city = await createCity(bench, DAYS);
  const houses = await foundHouses(city, [{ name: 'fermier', count: 4, sites: ['grow_wheat'] }]);
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
    // Du tick de la clôture à la clôture suivante, tous les ticks du jour (24 hors changement d'heure).
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

const MONTH = 30;
/** Mise en route, non mesurée : les maisons acquièrent leurs sites et les prix trouvent leur niveau. */
const WARMUP = 7;

it(
  '30 jours, 15 biens, maisons scriptées : sites acquis, grand livre rapproché',
  { timeout: 600_000 },
  async () => {
    const city = await createCity(bench, WARMUP + MONTH);
    const houses = (await foundHouses(city, ROLES)).map(seller);
    let [upkeep, acquisitions] = [0, 0];
    for (let day = 0; day < WARMUP + MONTH; day++) {
      upkeep += upkeepDue(city, houses, day);
      await closeDay(city, day);
      const now = new Date(closeOf(city, day).getTime() + MINUTE);
      for (const house of houses) acquisitions += await morning(city, house, now);
      // Un tick d'une heure par heure du jour de jeu : 24, sauf au changement d'heure.
      const hours =
        (closeOf(city, day + 1).getTime() - closeOf(city, day).getTime()) / (60 * MINUTE);
      expect(await tickDay(city, day)).toBe(hours);
    }

    // Robinets, puits et trésor de la cité rapprochés des flux comptés ; puis la masse en circulation.
    const ledger = await reconcile(city, houses.length, {
      sink_upkeep: upkeep,
      sink_site_acquisition: acquisitions,
    });
    expect(ledger.actual).toEqual(ledger.expected);
    expect(ledger.supply).toBe(ledger.mass);

    // Le marché a réellement tourné : des achats de PNJ, la taxe, l'entretien, des sites acquis.
    expect(ledger.expected['faucet_npc_purchases']).toBeLessThan(0);
    expect(ledger.expected['sink_market_tax']).toBeGreaterThan(0);
    expect(upkeep).toBeGreaterThan(0);
    expect(acquisitions).toBeGreaterThan(0);
    // Les bornes d'équilibrage (inflation mensuelle de 0 à 3 %, besoins vitaux couverts) attendent la
    // recalibration de la cité prototype (#78) et les mesures du banc.
  },
);

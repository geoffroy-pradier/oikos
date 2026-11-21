import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  chronicleFacts,
  chronicleNumbers,
  roundedQuotient,
  type ChronicleInput,
  type ChronicleInputEvent,
} from './chronicle';

const input = (events: ChronicleInputEvent[], extra: Partial<ChronicleInput> = {}) => ({
  cityId: 'kalliste',
  events,
  worldEvents: [],
  population: null,
  maxGoods: 3,
  ...extra,
});
const trade = (goodId: string, price: number, quantity: number, cityId = 'kalliste') =>
  ({ type: 'trade', cityId, goodId, price, quantity }) as const;
const CLOSE = Date.UTC(2026, 10, 17, 3);

describe('faits du jour d’une cité', () => {
  it('exemple : biens classés par volume, prix moyen arrondi, autres biens comptés, autres cités ignorées', () => {
    const facts = chronicleFacts(
      input([
        ...[trade('wheat', 6, 10), trade('wine', 20, 3), trade('wheat', 7, 5)],
        ...[trade('salt', 9, 1), trade('fish', 4, 15), trade('wheat', 99, 1000, 'elaia')],
      ]),
    );
    expect(facts.goods).toEqual([
      // (6×10 + 7×5) / 15 = 95 / 15 = 6,33 → 6 ; à volume égal, le plus gros montant d’abord.
      { goodId: 'wheat', volume: 15, turnover: 95, averagePrice: 6, lowPrice: 6, highPrice: 7 },
      { goodId: 'fish', volume: 15, turnover: 60, averagePrice: 4, lowPrice: 4, highPrice: 4 },
      { goodId: 'wine', volume: 3, turnover: 60, averagePrice: 20, lowPrice: 20, highPrice: 20 },
    ]);
    expect(facts.otherGoods).toBe(1);
    expect(chronicleFacts(input([trade('wheat', 1, 1)], { maxGoods: 0 }))).toMatchObject({
      goods: [],
      otherGoods: 1,
    });
  });

  it('journée vide : aucun fait, population inchangée comprise ; sans population, `null`', () => {
    expect(chronicleFacts(input([], { population: { before: 120, after: 120 } }))).toEqual({
      goods: [],
      otherGoods: 0,
      population: { before: 120, after: 120, change: 0 },
      arrivals: [],
      losses: [],
      elections: [],
      decrees: [],
      worldEvents: [],
      configChange: false,
    });
    expect(chronicleFacts(input([])).population).toBeNull();
  });

  it('pertes en mer (#730) : comptées par route vers la cité, sans maison, à côté des arrivées', () => {
    const event = (type: 'arrival' | 'loss', fromCityId: string, cityId = 'kalliste') =>
      ({ type, cityId, fromCityId }) as const;
    const facts = chronicleFacts(
      input([
        ...[event('arrival', 'halos'), event('loss', 'halos'), event('arrival', 'halos')],
        ...[event('loss', 'halos'), event('arrival', 'elaia'), event('loss', 'elaia')],
        // Perdue en allant de Kallistè vers Elaia : la chronique d'Elaia la dit, pas celle de Kallistè.
        event('loss', 'kalliste', 'elaia'),
      ]),
    );
    expect(facts.losses).toEqual([
      { fromCityId: 'halos', cargoes: 2 },
      { fromCityId: 'elaia', cargoes: 1 },
    ]);
    // Un navire qui a perdu sa cargaison est arrivé : il compte aussi parmi les arrivées.
    expect(facts.arrivals).toEqual([
      { fromCityId: 'halos', ships: 2 },
      { fromCityId: 'elaia', ships: 1 },
    ]);
    expect(JSON.stringify(facts.losses)).not.toMatch(/house/i);
    expect(chronicleNumbers(facts)).toEqual(new Set([0, 2, 1]));
  });

  it('arrivées, élections, décrets et événements du monde de la cité, dans un ordre fixe', () => {
    const arrival = (fromCityId: string, cityId = 'kalliste') =>
      ({ type: 'arrival', cityId, fromCityId }) as const;
    const facts = chronicleFacts(
      input(
        [
          ...[arrival('halos'), arrival('elaia'), arrival('halos'), arrival('kalliste', 'elaia')],
          { type: 'decree', cityId: 'kalliste', model: 'festival', outcome: 'applied' },
          {
            type: 'decree',
            cityId: 'kalliste',
            model: 'port_dues',
            outcome: 'rejected',
            votesFor: 2,
            votesAgainst: 2,
          },
          { type: 'election', cityId: 'kalliste', houseName: 'Philaïdes', votes: 7 },
          { type: 'election', cityId: 'halos', houseName: 'Alcméonides', votes: 9 },
        ],
        {
          population: { before: 130, after: 118 },
          worldEvents: [
            { model: 'storm', cityId: 'elaia', otherCityId: 'kalliste', goodId: null },
            { model: 'drought', cityId: 'kalliste', otherCityId: null, goodId: null },
            { model: 'caravan', cityId: 'halos', otherCityId: null, goodId: 'wine' },
          ],
        },
      ),
    );
    expect(facts.arrivals).toEqual([
      { fromCityId: 'halos', ships: 2 },
      { fromCityId: 'elaia', ships: 1 },
    ]);
    expect(facts.elections).toEqual([{ houseName: 'Philaïdes', votes: 7 }]);
    expect(facts.decrees).toEqual([
      { model: 'port_dues', outcome: 'rejected', votesFor: 2, votesAgainst: 2 },
      { model: 'festival', outcome: 'applied' },
    ]);
    expect(facts.worldEvents.map((event) => event.model)).toEqual(['drought', 'storm']);
    expect(facts.population).toEqual({ before: 130, after: 118, change: -12 });
    // 0 : aucun autre bien ; 12 : la baisse de population, en valeur absolue.
    expect(chronicleNumbers(facts)).toEqual(new Set([0, 2, 1, 7, 130, 118, 12]));
  });

  it('configuration : la dernière programmation d’une clôture l’emporte, une annulation l’efface', () => {
    const scheduled = { type: 'configScheduled', activateAt: CLOSE } as const;
    const cancelled = { type: 'configCancelled', activateAt: CLOSE } as const;
    const change = (events: ChronicleInputEvent[]) => chronicleFacts(input(events)).configChange;
    expect(change([scheduled])).toBe(true);
    expect(change([scheduled, cancelled])).toBe(false);
    expect(change([scheduled, cancelled, scheduled])).toBe(true);
    expect(change([cancelled])).toBe(false);
    // L’annulation d’une autre clôture ne la retire pas.
    expect(change([scheduled, { type: 'configCancelled', activateAt: CLOSE + 1 }])).toBe(true);
  });

  it('refuse prix, quantités, voix et population non entiers, et un montant hors des entiers sûrs', () => {
    const throws = (events: ChronicleInputEvent[], extra: Partial<ChronicleInput> = {}) =>
      expect(() => chronicleFacts(input(events, extra))).toThrow(RangeError);
    throws([trade('wheat', 0, 1)]);
    throws([trade('wheat', 1.5, 1)]);
    throws([trade('wheat', 2 ** 40, 2 ** 20), trade('wheat', 2 ** 40, 2 ** 20)]);
    throws([{ type: 'decree', cityId: 'kalliste', model: 'festival', outcome: 'adopted' }]);
    throws([
      { type: 'decree', cityId: 'kalliste', model: 'festival', outcome: 'applied', votesFor: 1 },
    ]);
    throws([{ type: 'election', cityId: 'kalliste', houseName: 'Philaïdes', votes: -1 }]);
    throws([{ type: 'configScheduled', activateAt: 0.5 }]);
    throws([], { population: { before: -1, after: 3 } });
    throws([], { maxGoods: -1 });
  });

  it('arrondi du prix moyen : moitié vers le haut, exact sur les grands entiers', () => {
    expect(roundedQuotient(5, 2) + roundedQuotient(7, 3) + roundedQuotient(0, 4)).toBe(5);
    expect(roundedQuotient(Number.MAX_SAFE_INTEGER, 3)).toBe(3_002_399_751_580_330);
    expect(() => roundedQuotient(1, 0)).toThrow(RangeError);
  });
});

describe('propriétés des faits', () => {
  const trades = fc.array(
    fc.record({
      type: fc.constant('trade' as const),
      cityId: fc.constantFrom('kalliste', 'elaia'),
      goodId: fc.constantFrom('wheat', 'wine', 'salt', 'fish', 'bread'),
      price: fc.integer({ min: 1, max: 10_000 }),
      quantity: fc.integer({ min: 1, max: 10_000 }),
    }),
    { maxLength: 60 },
  );
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  it('conservation : volumes et montants des échanges de la cité se retrouvent exactement', () => {
    fc.assert(
      fc.property(trades, (events) => {
        const facts = chronicleFacts(input(events, { maxGoods: 10 }));
        const own = events.filter((event) => event.cityId === 'kalliste');
        expect(sum(facts.goods.map((good) => good.volume))).toBe(sum(own.map((t) => t.quantity)));
        expect(sum(facts.goods.map((good) => good.turnover))).toBe(
          sum(own.map((t) => t.price * t.quantity)),
        );
        expect(facts.otherGoods).toBe(0);
      }),
    );
  });

  it('le prix moyen arrondi reste entre le plus bas et le plus haut, à une demi-obole au plus du vrai', () => {
    fc.assert(
      fc.property(trades, (events) => {
        for (const good of chronicleFacts(input(events, { maxGoods: 10 })).goods) {
          expect(good.lowPrice).toBeLessThanOrEqual(good.averagePrice);
          expect(good.averagePrice).toBeLessThanOrEqual(good.highPrice);
          expect(
            Math.abs(2 * (good.averagePrice * good.volume - good.turnover)),
          ).toBeLessThanOrEqual(good.volume);
        }
      }),
    );
  });

  it('l’ordre des échanges ne change rien, et la troncature garde les plus échangés', () => {
    fc.assert(
      fc.property(trades, fc.integer({ min: 0, max: 5 }), (events, maxGoods) => {
        const facts = chronicleFacts(input(events, { maxGoods }));
        expect(chronicleFacts(input([...events].reverse(), { maxGoods }))).toEqual(facts);
        const all = chronicleFacts(input(events, { maxGoods: 10 })).goods;
        expect(facts.goods).toEqual(all.slice(0, maxGoods));
        expect(facts.goods.length + facts.otherGoods).toBe(all.length);
      }),
    );
  });

  it('les nombres des faits sont des entiers positifs ou nuls, tous retenus par `chronicleNumbers`', () => {
    fc.assert(
      fc.property(trades, fc.nat(1000), fc.nat(1000), (events, before, after) => {
        const facts = chronicleFacts(input(events, { population: { before, after } }));
        const numbers = chronicleNumbers(facts);
        for (const good of facts.goods)
          for (const value of [good.volume, good.averagePrice, good.lowPrice, good.highPrice])
            expect(numbers.has(value)).toBe(true);
        expect(numbers.has(Math.abs(after - before))).toBe(true);
        for (const value of numbers) expect(Number.isSafeInteger(value) && value >= 0).toBe(true);
      }),
    );
  });
});

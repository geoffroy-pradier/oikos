import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  npcHouseRetreat,
  NPC_RETREAT_START,
  playerShareBps,
  type NpcRetreatSettings,
  type NpcSales,
} from './npc-retreat';

const SETTINGS: NpcRetreatSettings = {
  highShareBps: 8_000,
  lowShareBps: 4_000,
  windowDays: 2,
  days: 2,
};
const sales = (playerUnits: number, totalUnits: number): NpcSales => ({ playerUnits, totalUnits });

/** Joue des clôtures de suite, à partir de `open` sites ouverts sur `max`, comme le moteur : un site au plus par clôture. */
function play(settings: NpcRetreatSettings, days: readonly NpcSales[], open: number, max: number) {
  let state = NPC_RETREAT_START;
  const steps = [];
  for (const today of days) {
    const step = npcHouseRetreat(settings, state, today, { open, max });
    steps.push({ ...step, open });
    if (step.move === 'retreat') open -= 1;
    if (step.move === 'return') open += 1;
    state = step.state;
  }
  return { steps, open };
}

const settings = fc
  .tuple(
    fc.integer({ min: 0, max: 9_999 }),
    fc.integer({ min: 1, max: 10_000 }),
    fc.integer({ min: 1, max: 5 }),
    fc.integer({ min: 1, max: 5 }),
  )
  .filter(([low, high]) => low < high)
  .map(([lowShareBps, highShareBps, windowDays, days]) => ({
    lowShareBps,
    highShareBps,
    windowDays,
    days,
  }));
const day = fc
  .tuple(fc.nat({ max: 1_000 }), fc.nat({ max: 1_000 }))
  .map(([a, b]) => sales(Math.min(a, b), Math.max(a, b)));

describe('part des joueurs dans les ventes (#717)', () => {
  it('exemples : arrondi à l’inférieur, aucune vente vaut 0, une part au plus égale au total', () => {
    expect(playerShareBps([sales(2, 3)])).toBe(6_666);
    expect(playerShareBps([sales(1, 3), sales(1, 1)])).toBe(5_000);
    expect(playerShareBps([])).toBe(0);
    expect(playerShareBps([sales(0, 0), sales(0, 0)])).toBe(0);
    expect(playerShareBps([sales(5, 5)])).toBe(10_000);
    // Une entrée incohérente (plus de ventes des joueurs que de ventes) ne dépasse pas 100 %.
    expect(playerShareBps([sales(9, 3)])).toBe(10_000);
    // Des quantités au-delà des entiers sûrs une fois multipliées : calcul exact.
    expect(playerShareBps([sales(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER)])).toBe(
      9_999,
    );
  });
});

describe('retrait d’une maison PNJ (#717)', () => {
  it('exemples : retrait après `days` clôtures au-dessus du seuil haut, retour sous le seuil bas', () => {
    const { steps } = play(
      SETTINGS,
      [sales(9, 10), sales(9, 10), sales(9, 10), sales(6, 10), sales(0, 10), sales(0, 0)],
      2,
      2,
    );
    expect(steps.map((step) => [step.shareBps, step.move, step.open])).toEqual([
      [9_000, 'hold', 2],
      [9_000, 'retreat', 2],
      [9_000, 'retreat', 1],
      // Entre les deux seuils : rien, et la série recommence.
      [7_500, 'hold', 0],
      [3_000, 'return', 0],
      // Une clôture sans vente : la part est celle de la fenêtre, 0 ici, et la maison rouvre encore.
      [0, 'return', 1],
    ]);
  });

  it('exemples : au seuil exactement, rien ; la limite de la filière et l’absence de site bornent le mouvement', () => {
    const at = (share: NpcSales, open: number, max = 2) =>
      npcHouseRetreat({ ...SETTINGS, days: 1, windowDays: 1 }, NPC_RETREAT_START, share, {
        open,
        max,
      }).move;
    expect(at(sales(8, 10), 1)).toBe('hold');
    expect(at(sales(81, 100), 1)).toBe('retreat');
    expect(at(sales(4, 10), 1)).toBe('hold');
    expect(at(sales(39, 100), 1)).toBe('return');
    expect(at(sales(39, 100), 2)).toBe('hold');
    expect(at(sales(81, 100), 0)).toBe('hold');
  });

  it('la fenêtre ne garde que les `windowDays` dernières clôtures', () => {
    let state = NPC_RETREAT_START;
    for (const today of [sales(0, 100), sales(10, 10), sales(10, 10)])
      state = npcHouseRetreat(SETTINGS, state, today, { open: 1, max: 1 }).state;
    expect(state.window).toEqual([sales(10, 10), sales(10, 10)]);
  });

  it('propriétés : jamais de retrait sous le seuil haut, jamais de retour au-dessus du seuil bas, au plus un site par clôture', () => {
    fc.assert(
      fc.property(
        settings,
        fc.array(day, { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 1, max: 6 }),
        fc.nat({ max: 6 }),
        (chosen, days, max, start) => {
          const open = Math.min(start, max);
          const { steps } = play(chosen, days, open, max);
          let previous = open;
          for (const [index, step] of steps.entries()) {
            expect(Math.abs(step.open - previous)).toBeLessThanOrEqual(1);
            previous = step.open;
            if (step.move === 'retreat') {
              expect(step.shareBps).toBeGreaterThan(chosen.highShareBps);
              expect(step.open).toBeGreaterThan(0);
              // La part a dépassé le seuil haut à chacune des `days` dernières clôtures.
              expect(index + 1).toBeGreaterThanOrEqual(chosen.days);
              for (const earlier of steps.slice(index + 1 - chosen.days, index + 1))
                expect(earlier.shareBps).toBeGreaterThan(chosen.highShareBps);
            }
            if (step.move === 'return') {
              expect(step.shareBps).toBeLessThan(chosen.lowShareBps);
              expect(step.open).toBeLessThan(max);
            }
            expect(step.state.window.length).toBeLessThanOrEqual(chosen.windowDays);
            expect(step.shareBps).toBe(playerShareBps(step.state.window));
          }
          const last = steps.at(-1);
          const end = last
            ? last.open + (last.move === 'retreat' ? -1 : last.move === 'return' ? 1 : 0)
            : open;
          expect(end).toBeGreaterThanOrEqual(0);
          expect(end).toBeLessThanOrEqual(max);
        },
      ),
    );
  });

  it('propriété : déterministe, et une clôture ne dépend que de la mémoire et de ses ventes', () => {
    fc.assert(
      fc.property(settings, fc.array(day, { maxLength: 10 }), day, (chosen, history, today) => {
        const { steps } = play(chosen, history, 1, 3);
        const state = steps.at(-1)?.state ?? NPC_RETREAT_START;
        const first = npcHouseRetreat(chosen, state, today, { open: 1, max: 3 });
        expect(npcHouseRetreat(chosen, structuredClone(state), today, { open: 1, max: 3 })).toEqual(
          first,
        );
      }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import type { DayMeasure } from './measures';
import { compare, indicatorsOf, inflationBps, toMarkdown } from './report';

const day = (n: number, basket: number | null, extra: Partial<DayMeasure> = {}): DayMeasure => ({
  day: n,
  supply: { a: 1000 + n, world: 2000 + n },
  basket: { a: basket, world: basket },
  population: { a: 50 },
  coverage: { a: { poor: 9000, rich: null } },
  flows: { a: { sink_upkeep: -3 }, world: { sink_upkeep: -3, faucet_x: 5 } },
  traded: {},
  ...extra,
});

describe('inflationBps', () => {
  it('compare le coût moyen du panier des premiers et des derniers jours', () => {
    const days = [day(0, 100), day(1, 100), day(2, 110), day(3, 120)];
    // fenêtres de 2 jours : 100 puis 115
    expect(inflationBps(days, 'a', 10)).toBe(1500);
    expect(inflationBps(days, 'a', 1)).toBe(2000);
  });
  it('ignore les jours sans échange, et rend null sans prix à comparer', () => {
    expect(inflationBps([day(0, null), day(1, 100), day(2, null), day(3, 100)], 'a', 2)).toBe(0);
    expect(inflationBps([day(0, null), day(1, null)], 'a', 1)).toBeNull();
    expect(inflationBps([day(0, 100)], 'a', 5)).toBeNull();
  });
});

describe('indicatorsOf', () => {
  it('somme le net de chaque robinet et puits, et lit le dernier jour pour le reste', () => {
    const out = indicatorsOf([day(0, 100), day(1, 100)], { a: { grow_wheat: 12 } }, ['a'], 10);
    expect(out).toMatchObject({
      'supply/a': 1001,
      'supply/world': 2001,
      'flow/a/sink_upkeep': -6,
      'flow/world/faucet_x': 10,
      'population/a': 50,
      'coverage/a/poor': 9000,
      'coverage/a/rich': null,
      'margin/a/grow_wheat': 12,
      'inflation/a': 0,
    });
  });
});

describe('compare', () => {
  const meta = { seed: 's', days: 2 };
  it('rend l’écart absolu et en pourcentage, candidate moins référence', () => {
    const report = compare(
      { 'supply/a': 200, 'population/a': 0 },
      { 'supply/a': 150, 'population/a': 5 },
      meta,
    );
    expect(report.deltas).toEqual({ 'supply/a': -50, 'population/a': 5 });
    expect(report.deltaPercents).toEqual({ 'supply/a': -25, 'population/a': null });
  });
  it('compte pour zéro un robinet absent d’un côté, mais pas une autre mesure', () => {
    const report = compare(
      { 'flow/world/sink_x': -4, 'margin/a/r': 3 },
      { 'flow/world/faucet_y': 7 },
      meta,
    );
    expect(report.deltas).toEqual({
      'margin/a/r': null,
      'flow/world/faucet_y': 7,
      'flow/world/sink_x': 4,
    });
  });
  it('deux rapports identiques n’ont aucun écart', () => {
    const side = indicatorsOf([day(0, 100), day(1, 105)], {}, ['a'], 10);
    const report = compare(side, side, meta);
    expect(Object.values(report.deltas).filter((value) => value !== 0 && value !== null)).toEqual(
      [],
    );
  });
});

describe('toMarkdown', () => {
  it('écrit un tableau par groupe, avec les écarts signés', () => {
    const md = toMarkdown(
      compare(
        { 'supply/a': 100, 'flow/world/sink_x': -10 },
        { 'supply/a': 130, 'flow/world/sink_x': -10 },
        {
          seed: 'graine',
          days: 30,
        },
      ),
    );
    expect(md).toContain('`graine`');
    expect(md).toContain('## Masse monétaire');
    expect(md).toContain('| a | 100 | 130 | +30 | +30 |');
    expect(md).toContain('| world/sink_x | -10 | -10 | 0 | 0 |');
    expect(md).not.toContain('## Population');
  });
});

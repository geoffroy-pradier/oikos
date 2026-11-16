// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { along, archipelagoLayout, MAP_HEIGHT, MAP_WIDTH, voyageProgress } from './map-layout';

describe('dessin de l’archipel', () => {
  it('chaque cité a sa place, dans le cadre, la même quel que soit l’ordre de lecture', () => {
    const layout = archipelagoLayout(['kalliste', 'elaia', 'ampelos', 'halos']);
    expect([...layout.keys()]).toEqual(['ampelos', 'elaia', 'halos', 'kalliste']);
    expect(archipelagoLayout(['halos', 'ampelos', 'kalliste', 'elaia'])).toEqual(layout);
    const points = [...layout.values()];
    for (const { x, y } of points) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(MAP_WIDTH);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(MAP_HEIGHT);
    }
    expect(new Set(points.map(({ x, y }) => `${x},${y}`)).size).toBe(4);
  });

  it('une cité seule est au centre ; aucune cité, aucun point', () => {
    expect(archipelagoLayout(['kalliste']).get('kalliste')).toEqual({ x: 50, y: 35 });
    expect(archipelagoLayout([]).size).toBe(0);
  });

  it('un navire en mer est dessiné à la part du trajet faite, sans sortir de sa route', () => {
    const departed = '2026-11-16T10:00:00Z';
    const arrives = '2026-11-16T14:00:00Z';
    expect(voyageProgress(departed, arrives, new Date('2026-11-16T11:00:00Z'))).toBe(0.25);
    expect(voyageProgress(departed, arrives, new Date('2026-11-16T09:00:00Z'))).toBe(0);
    expect(voyageProgress(departed, arrives, new Date('2026-11-16T20:00:00Z'))).toBe(1);
    expect(voyageProgress('illisible', arrives, new Date())).toBe(1);
    expect(along({ x: 0, y: 0 }, { x: 40, y: 20 }, 0.25)).toEqual({ x: 10, y: 5 });
  });
});

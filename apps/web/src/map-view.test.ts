// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { clampView, FULL_VIEW, recenter, viewAfterKey, viewBox, zoomAt } from './map-view';

describe('vue de la carte, bornée au dessin', () => {
  it('le zoom va de 1 à 4 ; la vue ne sort jamais du dessin', () => {
    expect(clampView({ x: 50, y: 35, zoom: 0.5 })).toEqual(FULL_VIEW);
    expect(clampView({ x: -10, y: 500, zoom: 9 })).toEqual({ x: 12.5, y: 61.25, zoom: 4 });
    expect(clampView({ x: Number.NaN, y: 35, zoom: Number.NaN })).toEqual(FULL_VIEW);
    expect(viewBox({ x: 80, y: 10, zoom: 2 })).toEqual({ x: 50, y: 0, width: 50, height: 35 });
  });

  it('zoom autour d’un point qui reste en place à l’écran', () => {
    const view = zoomAt(FULL_VIEW, 2, { x: 30, y: 20 });
    expect(view).toEqual({ x: 40, y: 27.5, zoom: 2 });
    // Le point visé est au même endroit relatif de la vue, avant et après (30 % et 2/7 de la vue).
    const box = viewBox(view);
    expect((30 - box.x) / box.width).toBeCloseTo(0.3);
    expect((20 - box.y) / box.height).toBeCloseTo(20 / 70);
    expect(zoomAt(view, 1 / 2, { x: 30, y: 20 })).toEqual(FULL_VIEW);
  });

  it('clavier : flèches, + et −, 0 recentre sur la cité de la maison ; une autre touche ne fait rien', () => {
    const zoomed = { x: 50, y: 35, zoom: 2 };
    expect(viewAfterKey(zoomed, 'ArrowRight', undefined)).toEqual({ x: 57.5, y: 35, zoom: 2 });
    expect(viewAfterKey(zoomed, 'ArrowUp', undefined)).toEqual({ x: 50, y: 29.75, zoom: 2 });
    expect(viewAfterKey(FULL_VIEW, 'ArrowLeft', undefined)).toEqual(FULL_VIEW);
    expect(viewAfterKey(FULL_VIEW, '+', undefined)?.zoom).toBe(1.5);
    expect(viewAfterKey(zoomed, '-', undefined)?.zoom).toBeCloseTo(4 / 3);
    expect(viewAfterKey(FULL_VIEW, '0', { x: 50, y: 36 })).toEqual({ x: 50, y: 36, zoom: 2 });
    expect(viewAfterKey(FULL_VIEW, 'a', undefined)).toBeUndefined();
  });

  it('recentrer garde un zoom plus fort ; sans cité de la maison, tout le dessin', () => {
    expect(recenter({ x: 10, y: 10, zoom: 3 }, { x: 79, y: 16 })).toEqual({
      x: 79,
      y: 16,
      zoom: 3,
    });
    expect(recenter({ x: 10, y: 10, zoom: 3 }, undefined)).toEqual(FULL_VIEW);
  });
});

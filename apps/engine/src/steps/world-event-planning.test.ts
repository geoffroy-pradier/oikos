import { WORLD_EVENT_MODELS } from '@oikos/config';
import { WORLD_EVENT_CATALOGUE } from '@oikos/sim';
import { describe, expect, it } from 'vitest';
import { eventDaySeed } from './world-event-planning';

describe('graine des événements d’un jour (13, #267)', () => {
  it('dérivée de la graine du monde et du jour, à sens unique, stable', () => {
    // Valeur de référence : SHA-256 de « graine:20000 ». La changer change les événements de tous les mondes.
    expect(eventDaySeed('graine', 20_000)).toBe(
      '3c236adff0d5c22796262b90b686288f2a2f7bb7fe53ebe0b88cf363521e09e6',
    );
    expect(eventDaySeed('graine', 20_001)).not.toBe(eventDaySeed('graine', 20_000));
    expect(eventDaySeed('graine2', 20_000)).not.toBe(eventDaySeed('graine', 20_000));
    expect(() => eventDaySeed('graine', 1.5)).toThrow(RangeError);
  });

  it('le catalogue de la simulation est celui de la configuration, dans le même ordre', () => {
    expect(Object.keys(WORLD_EVENT_CATALOGUE)).toEqual([...WORLD_EVENT_MODELS]);
  });
});

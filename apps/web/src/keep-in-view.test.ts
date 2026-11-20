// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepInView } from './keep-in-view';

const observers: { callback: () => void; disconnected: boolean }[] = [];
vi.stubGlobal(
  'ResizeObserver',
  class {
    entry = { callback: (): void => undefined, disconnected: false };
    constructor(callback: () => void) {
      this.entry.callback = callback;
      observers.push(this.entry);
    }
    observe() {}
    disconnect() {
      this.entry.disconnected = true;
    }
  },
);
afterEach(() => {
  observers.length = 0;
  vi.useRealTimers();
});

function follow() {
  const element = document.createElement('p');
  const scroll = vi.fn();
  element.scrollIntoView = scroll;
  const stop = keepInView(element, 1_000);
  const [observer] = observers;
  if (!observer) throw new Error('aucun observateur');
  return { scroll, stop, observer };
}

describe('résultat gardé dans la fenêtre (#869)', () => {
  it('rendu visible à l’annonce, puis à chaque changement de taille de la page', () => {
    const { scroll, observer } = follow();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
    observer.callback();
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'])(
    'un geste du joueur (%s) arrête le suivi',
    (gesture) => {
      const { observer } = follow();
      window.dispatchEvent(new Event(gesture));
      expect(observer.disconnected).toBe(true);
    },
  );

  it('borné dans le temps, et arrêté par l’écran (démontage, message suivant)', () => {
    vi.useFakeTimers();
    const first = follow();
    vi.advanceTimersByTime(1_000);
    expect(first.observer.disconnected).toBe(true);
    observers.length = 0;
    const second = follow();
    second.stop();
    expect(second.observer.disconnected).toBe(true);
    // Arrêté, il n'écoute plus les gestes.
    const remove = vi.spyOn(window, 'removeEventListener');
    window.dispatchEvent(new Event('wheel'));
    expect(remove).not.toHaveBeenCalled();
  });
});

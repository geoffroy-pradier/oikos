import { CLIENT_SETTINGS } from '@oikos/config/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleUpdateChecks } from './update-checks';

afterEach(() => vi.useRealTimers());

function setup(active = () => true) {
  vi.useFakeTimers();
  const update = vi.fn(() => Promise.resolve(undefined));
  const stop = scheduleUpdateChecks({ update } as never, 60, {
    setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    active,
  });
  return { update, stop };
}

describe('vérification périodique d’une nouvelle version', () => {
  it('vérifie à chaque intervalle, pas avant', () => {
    const { update } = setup();
    vi.advanceTimersByTime(60 * 60_000 - 1);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60 * 60_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('onglet caché ou hors ligne : aucune vérification', () => {
    let active = false;
    const { update } = setup(() => active);
    vi.advanceTimersByTime(3 * 60 * 60_000);
    expect(update).not.toHaveBeenCalled();
    active = true;
    vi.advanceTimersByTime(60 * 60_000);
    expect(update).toHaveBeenCalledOnce();
  });

  it('arrêtée, elle ne vérifie plus ; un échec de vérification n’arrête rien', async () => {
    const { update, stop } = setup();
    update.mockRejectedValueOnce(new Error('offline'));
    vi.advanceTimersByTime(60 * 60_000);
    await Promise.resolve();
    vi.advanceTimersByTime(60 * 60_000);
    expect(update).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(10 * 60 * 60_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('l’intervalle vient de la configuration du client, en minutes entières et positives', () => {
    expect(Number.isInteger(CLIENT_SETTINGS.updateCheckMinutes)).toBe(true);
    expect(CLIENT_SETTINGS.updateCheckMinutes).toBeGreaterThan(0);
  });
});

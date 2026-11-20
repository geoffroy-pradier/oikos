// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';
import { COMMAND_SUCCEEDED_EVENT } from './api';
import { HouseProvider } from './house';
import fr from './locales/fr.json';

// Chaque relecture rend le solde suivant de la file.
const reads = vi.hoisted(() => ({ queue: [] as number[], count: 0 }));
vi.mock('./data', () => ({
  useRows: () => {
    const [balance, setBalance] = useState(500);
    return {
      rows: [{ balance }],
      failed: false,
      reload: () => {
        reads.count += 1;
        const next = reads.queue.shift();
        if (next !== undefined) setBalance(next);
        return Promise.resolve(null);
      },
    };
  },
}));
const { HouseCard } = await import('./ShellHouse');

async function mount() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = {
    id: 'h',
    name: 'Alcméonides',
    cityId: 'k',
    cityName: 'Kallistè',
    cityNames: {},
    accessToken: 't',
    citizenshipStatus: 'metic' as const,
    blazon: null,
  };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={house}>
        <HouseCard />
      </HouseProvider>
    </I18nextProvider>,
  );
}

afterEach(() => {
  cleanup();
  reads.queue = [];
  reads.count = 0;
});

const treasury = () => screen.getByText('Trésorerie').parentElement?.textContent ?? '';

it('relit la trésorerie après une commande réussie', async () => {
  await mount();
  const before = treasury();
  reads.queue.push(123456);
  act(() => void window.dispatchEvent(new Event(COMMAND_SUCCEEDED_EVENT)));
  expect(reads.count).toBe(1);
  expect(treasury()).not.toBe(before);
});

it('relit la trésorerie quand l’onglet redevient visible, pas quand il se cache', async () => {
  await mount();
  const initial = reads.count;
  const state = vi.spyOn(document, 'visibilityState', 'get');
  state.mockReturnValue('hidden');
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
  expect(reads.count).toBe(initial);
  reads.queue.push(777);
  state.mockReturnValue('visible');
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
  expect(reads.count).toBe(initial + 1);
  state.mockRestore();
});

it('retire ses écouteurs au démontage', async () => {
  const view = await mount();
  view.unmount();
  const count = reads.count;
  window.dispatchEvent(new Event(COMMAND_SUCCEEDED_EVENT));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(reads.count).toBe(count);
});

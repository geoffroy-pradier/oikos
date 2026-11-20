// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import { PROFILE_VIEWS } from '../house-profile';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

const OWN = '01900000-0000-7000-8000-00000000000a';
const OTHER = '01900000-0000-7000-8000-00000000000b';
// Lectures simulées, par vue, et vues interrogées.
const state = vi.hoisted(() => ({
  views: {} as Record<string, unknown[] | null>,
  asked: [] as { view: string; filters: unknown }[],
  param: '' as string | undefined,
  back: vi.fn(),
}));
vi.mock('../data', () => ({
  useRows: (view: string, _columns: string, _order: string, filters: unknown) => {
    state.asked.push({ view, filters });
    const rows = filters === null ? null : (state.views[view] ?? []);
    return { rows, failed: false, reload: () => Promise.resolve(rows) };
  },
}));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ houseId: state.param }),
  useRouter: () => ({ history: { back: state.back }, navigate: vi.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
const { HouseProfileScreen } = await import('./HouseProfile');

const house = (id: string, world: string, extra = {}) => ({
  id,
  world_id: world,
  name: id === OWN ? 'Maison Test' : 'Maison Alpha',
  blazon: { shape: 'pelte', tincture: 'black', emblem: 'trident' },
  city_id: 'c1',
  citizenship_status: 'metic',
  ...extra,
});
const office = (start: string, end: string, inOffice: boolean) => ({
  office: 'archon',
  city_id: 'c1',
  starts_at: start,
  ends_at: end,
  in_office: inOffice,
});
async function show(lng: 'fr' | 'en' = 'fr') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    interpolation: { escapeValue: false },
  });
  render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{
          id: OWN,
          name: 'Maison Test',
          cityId: 'c1',
          accessToken: 't',
          cityName: 'Kallistè',
          cityNames: { c1: 'Kallistè' },
          citizenshipStatus: 'metic',
        }}
      >
        <HouseProfileScreen />
      </HouseProvider>
    </I18nextProvider>,
  );
}
beforeEach(() => {
  state.views = {
    houses: [house(OWN, 'w1'), house(OTHER, 'w1', { citizenship_status: 'citizen' })],
    house_honor: [{ honor: 1250 }],
    offices: [
      office('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', false),
      office('2026-03-01T00:00:00Z', '2099-01-01T00:00:00Z', true),
    ],
  };
  state.asked = [];
  state.param = OTHER;
});
afterEach(cleanup);

describe('fiche publique d’une maison (#705)', () => {
  it('montre le nom, la cité, le statut, la Timè et les mandats, en cours d’abord', async () => {
    await show();
    const title = screen.getByRole('heading', { level: 1, name: 'Maison Alpha' });
    expect(document.activeElement).toBe(title);
    expect(screen.getByText('Citoyenne de Kallistè')).toBeTruthy();
    expect(screen.getByText('Timè').nextElementSibling?.textContent).toBe(
      new Intl.NumberFormat('fr').format(1250),
    );
    const mandates = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(mandates).toHaveLength(2);
    expect(mandates[0]).toMatch(/En cours/);
    expect(mandates[1]).toMatch(/Terminé/);
    expect(mandates[0]).toMatch(/Archonte/);
  });

  it('en anglais, et sans mandat', async () => {
    state.views['offices'] = [];
    await show('en');
    expect(screen.getByText('Citizen of Kallistè')).toBeTruthy();
    expect(screen.getByText('This house has held no mandate.')).toBeTruthy();
  });

  it('un métèque se dit métèque', async () => {
    state.param = OWN;
    await show();
    expect(screen.getByText('Métèque à Kallistè')).toBeTruthy();
  });

  it('ne lit que des vues publiques, et rien de plus pour une maison inconnue', async () => {
    await show();
    const views = new Set(state.asked.map((read) => read.view));
    expect([...views].every((view) => (PROFILE_VIEWS as readonly string[]).includes(view))).toBe(
      true,
    );
    expect([...views].some((view) => view.startsWith('my_'))).toBe(false);
  });

  it.each([
    ['maison absente', () => (state.views['houses'] = [house(OWN, 'w1')])],
    [
      'maison d’un autre monde',
      () => (state.views['houses'] = [house(OWN, 'w1'), house(OTHER, 'w2')]),
    ],
    ['adresse mal formée', () => (state.param = 'pas-un-identifiant')],
  ])('%s : l’écran introuvable, sans Timè ni mandats lus', async (_name, setup) => {
    setup();
    await show();
    expect(screen.getByRole('heading', { name: fr.shell.notFound })).toBeTruthy();
    expect(screen.queryByText('Maison Alpha')).toBeNull();
    const read = state.asked.filter((r) => r.filters !== null).map((r) => r.view);
    expect(read.filter((view) => view !== 'houses')).toEqual([]);
  });

  it('le retour est un bouton, au clavier', async () => {
    window.history.pushState({}, '', '/messages');
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(state.back).toHaveBeenCalledOnce();
  });
});

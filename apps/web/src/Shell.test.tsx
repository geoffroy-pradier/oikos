// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from './house';
import fr from './locales/fr.json';

vi.mock('./data', () => ({
  useRows: () => ({ rows: [{ balance: 600 }], failed: false, reload: () => Promise.resolve(null) }),
}));
vi.mock('./supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock('./screens/SanctionNotice', () => ({ SanctionNotice: () => null }));
vi.mock('./router', async () => ({
  ...(await import('./tabs')),
  router: { navigate: vi.fn() },
}));
const { Shell } = await import('./Shell');

async function mount(path: string) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
  })) as typeof window.matchMedia;
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const root = createRootRoute({ component: Shell });
  const page = (to: string) =>
    createRoute({ getParentRoute: () => root, path: to, component: () => <p>écran {to}</p> });
  const router = createRouter({
    routeTree: root.addChildren(
      ['/', '/carte', '/agora', '/cite', '/messages', '/comptes'].map(page),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const house = {
    id: 'h',
    name: 'Alcméonides',
    cityId: 'k',
    cityName: 'Kallistè',
    cityNames: {},
    accessToken: 't',
    citizenshipStatus: 'metic' as const,
    blazon: { shape: 'hoplon', tincture: 'ochre', emblem: 'owl' } as const,
  };
  render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={house}>
        <RouterProvider router={router} />
      </HouseProvider>
    </I18nextProvider>,
  );
  await screen.findByRole('navigation', { name: 'Navigation principale' });
}
afterEach(cleanup);

describe('coquille : navigation', () => {
  it('marque l’onglet actif, et seulement lui', async () => {
    await mount('/agora');
    const links = within(screen.getByRole('navigation')).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([
      null,
      null,
      'page',
      null,
      null,
    ]);
    expect(screen.getByRole('link', { name: 'Agora' }).className).toContain('text-primary');
  });

  it('garde Maison actif sur un écran qui en dépend', async () => {
    await mount('/comptes');
    expect(screen.getByRole('link', { name: 'Maison' }).getAttribute('aria-current')).toBe('page');
  });

  it('se parcourt au clavier : un lien tabulable par onglet, dans l’ordre', async () => {
    await mount('/');
    const names = within(screen.getByRole('navigation'))
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names).toEqual(['Maison', 'Carte', 'Agora', 'Cité', 'Messages']);
    const links = within(screen.getByRole('navigation')).getAllByRole('link');
    expect(links.every((link) => link.getAttribute('tabindex') !== '-1')).toBe(true);
  });

  it('montre la maison, son blason et sa trésorerie dans l’en-tête', async () => {
    await mount('/');
    expect(screen.getByText('Maison Alcméonides')).toBeTruthy();
    expect(screen.getByText('Kallistè')).toBeTruthy();
    expect(screen.getByText('Trésorerie').parentElement?.textContent).toContain('100 drachmes');
  });
});

describe('coquille : réglages', () => {
  it('le panneau s’ouvre au bouton, se referme à Échap et rend le foyer au bouton', async () => {
    await mount('/');
    const button = screen.getByRole('button', { name: 'Réglages' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Thème sombre' })).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Thème sombre' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

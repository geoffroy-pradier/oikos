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
const { supabase } = await import('./supabase');
const { router } = await import('./router');

async function mount(path: string) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
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
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset['theme'];
});

/** Barre latérale (ordinateur) et barre d'onglets (téléphone) : un seul élément `nav`. */
const nav = () => screen.getByRole('navigation', { name: 'Navigation principale' });

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

  it('montre la maison, son blason et sa trésorerie dans la barre latérale', async () => {
    await mount('/');
    expect(within(nav()).getByText('Maison Alcméonides')).toBeTruthy();
    expect(within(nav()).getByText('Kallistè').parentElement?.textContent).toBe(
      'Kallistè · Métèque',
    );
    expect(within(nav()).getByText('Trésorerie').parentElement?.textContent).toContain(
      '100 drachmes',
    );
    // La marque n'est pas un lien : les cinq onglets restent les seuls liens de la navigation.
    expect(within(nav()).getByText('OIKOS')).toBeTruthy();
  });

  it('montre sur téléphone un en-tête compact : maison, cité et heure de jeu, Réglages', async () => {
    await mount('/');
    const header = screen.getByRole('banner');
    expect(within(header).getByText('Maison Alcméonides')).toBeTruthy();
    expect(header.querySelector('time')?.parentElement?.textContent).toMatch(
      /^Kallistè · \d{2}:\d{2}$/,
    );
    expect(within(header).getByRole('button', { name: 'Réglages' })).toBeTruthy();
  });
});

describe('coquille : réglages', () => {
  it('la feuille s’ouvre au bouton, se referme à Échap et rend le foyer au bouton', async () => {
    await mount('/');
    const button = within(nav()).getByRole('button', { name: 'Réglages' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
    button.focus();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const sheet = screen.getByRole('dialog', { name: 'Réglages' });
    expect(within(sheet).getByRole('radiogroup', { name: 'Thème' })).toBeTruthy();
    expect(within(sheet).getByLabelText('Langue')).toHaveProperty('value', 'fr');
    expect(within(sheet).getByRole('button', { name: 'Se déconnecter' })).toBeTruthy();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('thème clair, sombre ou celui de l’appareil : appliqué et mémorisé', async () => {
    await mount('/');
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Réglages' }));
    const radio = (name: string) => screen.getByRole('radio', { name });
    // Rien de mémorisé : le thème de l'appareil est le choix en cours.
    expect(radio('Appareil').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radio('Sombre'));
    expect(radio('Sombre').getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(window.localStorage.getItem('oikos.theme')).toBe('dark');
    // Appareil en clair (`matchMedia` du montage) : le thème suit, la mémoire est effacée.
    fireEvent.click(radio('Appareil'));
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(window.localStorage.getItem('oikos.theme')).toBeNull();
  });

  it('la déconnexion ferme la session et revient à l’accueil', async () => {
    await mount('/agora');
    fireEvent.click(within(nav()).getByRole('button', { name: 'Réglages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(router.navigate).toHaveBeenCalledWith({ to: '/' });
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });
});

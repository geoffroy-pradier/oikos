// @vitest-environment jsdom
import { INITIAL_CONFIG } from '@oikos/config';
import { cleanup, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Écran Sites : un champ, 500 drachmes en trésorerie.
const views: Record<string, object[]> = {
  my_sites: [
    {
      id: 's1',
      city_id: 'c1',
      recipe_id: 'grow_wheat',
      cycle_started_at: '2026-01-01T00:00:00Z',
      halted_at: null,
    },
  ],
  my_treasury: [{ balance: 3000 }],
  my_inventories: [{ id: 'i1', city_id: 'c1', good_id: 'wheat', quantity: 40, reserved: 0 }],
};
vi.mock('../data', async () => {
  const { parseSiteRules } = await import('../site-rules');
  const rules = parseSiteRules(INITIAL_CONFIG);
  return {
    useRows: (view: string) => ({
      rows: views[view] ?? [],
      failed: false,
      reload: () => Promise.resolve(views[view] ?? []),
    }),
    useSiteRules: () => ({ rules, failed: false, reload: () => Promise.resolve() }),
    useClockRules: () => ({ rules: null, failed: false, reload: () => Promise.resolve() }),
  };
});
// L'heure du serveur, lue ou pas encore : sans elle, rien n'est compté prêt.
const clock = vi.hoisted(() => ({ synced: true }));
vi.mock('../server-clock', () => ({
  serverClock: { now: () => new Date() },
  syncServerClock: () => (clock.synced ? Promise.resolve() : new Promise(() => undefined)),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: React.ReactNode; to: string; 'aria-current'?: 'page' }) => (
    <a href={props.to} aria-current={props['aria-current']}>
      {props.children}
    </a>
  ),
  useRouterState: () => '/sites',
}));
const { SitesScreen } = await import('./Sites');

afterEach(cleanup);

describe('écran Sites', () => {
  it('son titre, les rubriques de la maison, ses chiffres clés et la fiche demandée par l’adresse', async () => {
    window.location.hash = '#site-s1';
    Element.prototype.scrollIntoView = () => undefined;
    const instance = i18next.createInstance();
    await instance
      .use(initReactI18next)
      .init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
    render(
      <I18nextProvider i18n={instance}>
        <HouseProvider
          value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
        >
          <SitesScreen />
        </HouseProvider>
      </I18nextProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: fr.home.sites })).toBeTruthy();
    // La liste a son titre de niveau 2 : les fiches, de niveau 3, ne sautent pas de niveau (axe, heading-order).
    expect(screen.getByRole('heading', { level: 2, name: fr.home.sitesList })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: fr.home.sectionsNav });
    const current = [...nav.querySelectorAll('a[aria-current="page"]')].map((a) => a.textContent);
    expect(current).toEqual([fr.home.nav.sites]);
    expect(await screen.findByText('500 drachmes')).toBeTruthy();
    expect(screen.getByText('1 sur 4')).toBeTruthy();
    // Le champ, plein depuis longtemps, est prêt ; « Détails » du tableau de bord y mène et y pose le foyer.
    expect(screen.getByText(fr.sites.ready).closest('section')?.textContent).toContain(
      '1site prêt',
    );
    expect(screen.getByText(fr.sites.daily)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Champ de blé' }));
    // Quelque chose à récolter : « Récolter », action principale du site, est actif.
    const collect = screen.getByRole('button', { name: 'Récolter : Champ de blé' });
    expect(collect.getAttribute('aria-disabled')).toBe('false');
    expect(collect.className).toContain('bg-primary');
  });

  it('« Acquérir un site » est l’action principale de l’en-tête, à droite du titre', async () => {
    const instance = i18next.createInstance();
    await instance
      .use(initReactI18next)
      .init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
    render(
      <I18nextProvider i18n={instance}>
        <HouseProvider
          value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
        >
          <SitesScreen />
        </HouseProvider>
      </I18nextProvider>,
    );
    const title = screen.getByRole('heading', { level: 1, name: fr.home.sites });
    const header = title.closest<HTMLElement>('[data-slot="page-header"]');
    if (!header) throw new Error('en-tête');
    const acquire = await within(header).findByRole('button', { name: fr.home.acquire });
    expect(acquire.closest('[data-slot="page-header-action"]')).toBeTruthy();
    // Une seule fois sur l'écran : plus de bouton flottant entre les chiffres clés et les fiches.
    expect(screen.getAllByRole('button', { name: fr.home.acquire })).toHaveLength(1);
  });

  it('cycle à peine commencé : « Récolter » inactif, décrit par « Rien à récolter » (#864)', async () => {
    const field = views['my_sites']?.[0];
    views['my_sites'] = [{ ...field, cycle_started_at: new Date().toISOString() }];
    window.location.hash = '';
    const instance = i18next.createInstance();
    await instance
      .use(initReactI18next)
      .init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
    render(
      <I18nextProvider i18n={instance}>
        <HouseProvider
          value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
        >
          <SitesScreen />
        </HouseProvider>
      </I18nextProvider>,
    );
    const collect = await screen.findByRole('button', { name: 'Récolter : Champ de blé' });
    await screen.findByText(fr.home.harvestNone);
    expect(collect.getAttribute('aria-disabled')).toBe('true');
    const why = document.getElementById(collect.getAttribute('aria-describedby') ?? '');
    expect(why?.textContent).toBe(fr.home.harvestNone);
    views['my_sites'] = [field ?? {}];
  });

  it('heure du serveur pas encore lue : « Prêts à récolter » dit « — », jamais zéro', async () => {
    clock.synced = false;
    window.location.hash = '';
    const instance = i18next.createInstance();
    await instance
      .use(initReactI18next)
      .init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
    render(
      <I18nextProvider i18n={instance}>
        <HouseProvider
          value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
        >
          <SitesScreen />
        </HouseProvider>
      </I18nextProvider>,
    );
    await screen.findByText('1 sur 4');
    expect(screen.getByText(fr.sites.ready).closest('section')?.textContent).toBe(
      `${fr.sites.ready}—`,
    );
    clock.synced = true;
  });
});

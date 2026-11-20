// @vitest-environment jsdom
import { INITIAL_CONFIG } from '@oikos/config';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Production en cours du tableau de bord : un champ plein depuis longtemps, un autre commencé il y a une heure.
const NOW = new Date('2026-06-01T00:00:00Z');
const sites = [
  { id: 's1', city_id: 'c1', recipe_id: 'grow_wheat', cycle_started_at: '2026-01-01T00:00:00Z' },
  { id: 's2', city_id: 'c1', recipe_id: 'grow_olives', cycle_started_at: '2026-05-31T23:00:00Z' },
].map((site) => ({ ...site, halted_at: null }));
const api = vi.hoisted(() => ({ collectSite: vi.fn() }));
vi.mock('../api', () => ({ collectSite: api.collectSite }));
vi.mock('../data', async () => {
  const { parseSiteRules } = await import('../site-rules');
  const rules = parseSiteRules(INITIAL_CONFIG);
  const reload = () => Promise.resolve(sites);
  return {
    useRows: (view: string) => ({ rows: view === 'my_sites' ? sites : [], failed: false, reload }),
    useSiteRules: () => ({ rules, failed: false, reload }),
  };
});
vi.mock('../server-clock', () => ({
  serverClock: { now: () => NOW },
  syncServerClock: () => Promise.resolve(),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: React.ReactNode; 'aria-label': string; hash: string }) => (
    <a aria-label={props['aria-label']} href={`/sites#${props.hash}`}>
      {props.children}
    </a>
  ),
}));
const { SitesCard } = await import('./Sites');

async function show() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({ resources: { fr: { translation: fr } }, lng: 'fr' });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
      >
        <SitesCard variant="production" stock={[]} onChanged={() => Promise.resolve()} />
      </HouseProvider>
    </I18nextProvider>,
  );
}
Element.prototype.scrollIntoView = () => undefined;
afterEach(cleanup);

describe('SitesCard en production en cours', () => {
  it('chaque site : son cycle à l’heure du serveur, et ce qui est prêt d’après l’estimation de la fiche', async () => {
    await show();
    const full = await screen.findByRole('progressbar', {
      name: 'Prochaine récolte : Champ de blé',
    });
    expect(full.getAttribute('aria-valuetext')).toBe(fr.production.full);
    expect(screen.getByText('Prêt : 720 × Blé')).toBeTruthy();
    // L'oliveraie a une heure de cycle faite : le temps qui reste est dit, rien n'est prêt.
    const olives = screen.getByRole('progressbar', { name: 'Prochaine récolte : Oliveraie' });
    expect(olives.getAttribute('aria-valuetext')).toMatch(/^Cycle suivant dans \d+ h \d{2}$/);
    expect(screen.getAllByText(fr.production.nothing)).toHaveLength(1);
    // « Récolter » reste proposé sur un site sans rien de prêt : l'API dit pourquoi.
    expect(screen.getAllByRole('button', { name: /^Récolter : / })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Détails : Oliveraie' }).getAttribute('href')).toBe(
      '/sites#site-s2',
    );
  });

  it('« Tout récolter » ne compte que les sites prêts ; une récolte part par la commande de la fiche', async () => {
    api.collectSite.mockResolvedValue({
      ok: true,
      replayed: false,
      data: { cycles: 18, outputs: [{ goodId: 'wheat', quantity: 720 }] },
    });
    await show();
    expect(
      await screen.findByRole('button', { name: 'Tout récolter : 1 site à récolter' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Récolter : Champ de blé' }));
    const row = screen.getByRole('heading', { name: 'Champ de blé' }).closest('li');
    await waitFor(() =>
      expect(
        [...(row?.querySelectorAll('[role="status"]') ?? [])].map((region) => region.textContent),
      ).toContain('Récolte engrangée : 720 × Blé.'),
    );
    expect(api.collectSite).toHaveBeenCalledWith('s1', 't');
  });

  it('acquisition restée sans réponse : rappelée avec un lien vers Sites, tant que la liste n’est pas vérifiée', async () => {
    window.sessionStorage.setItem('oikos.unanswered.h1', '1');
    await show();
    expect(await screen.findByText(fr.home.acquireUnanswered)).toBeTruthy();
    expect(screen.getByText(fr.production.checkSites).closest('a')?.getAttribute('href')).toMatch(
      /^\/sites/,
    );
    cleanup();
    window.sessionStorage.removeItem('oikos.unanswered.h1');
    await show();
    await screen.findByRole('button', { name: 'Récolter : Champ de blé' });
    expect(screen.queryByText(fr.home.acquireUnanswered)).toBeNull();
  });
});

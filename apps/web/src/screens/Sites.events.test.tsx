// @vitest-environment jsdom
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Récolte sous les événements de rendement (#417) : un champ et une oliveraie de 10 unités par cycle d'une
// heure, démarrés à minuit ; il est 3 h 30 à l'heure du serveur, trois cycles sont finis (1 h, 2 h, 3 h).
const config = INITIAL_CONFIG as GameConfig;
const quick = (id: string) => {
  const recipe = config.recipes.find((candidate) => candidate.id === id);
  if (!recipe?.outputs[0]) throw new Error(`${id} missing`);
  return { ...recipe, durationMinutes: 60, outputs: [{ ...recipe.outputs[0], quantity: 10 }] };
};
const site = (id: string, recipeId: string) => ({
  id,
  city_id: 'c1',
  recipe_id: recipeId,
  cycle_started_at: '2026-06-01T00:00:00Z',
  halted_at: null,
});
const event = (id: string, model: string, from: string, magnitude: number, cityId = 'c1') => ({
  id,
  model,
  city_id: cityId,
  other_city_id: null,
  good_id: null,
  starts_at: `2026-06-01T${from}:00Z`,
  ends_at: '2026-06-02T00:00:00Z',
  magnitude_bps: magnitude,
});
const state = vi.hoisted(() => ({
  sites: [] as unknown[],
  events: [] as unknown[] | null,
  reads: new Map<string, unknown>(),
}));
const api = vi.hoisted(() => ({ collectSite: vi.fn() }));
vi.mock('../api', () => ({
  collectSite: api.collectSite,
  acquireSite: vi.fn(),
  restartSite: vi.fn(),
  setSiteRecipe: vi.fn(),
}));
vi.mock('../data', async () => {
  const { parseSiteRules } = await import('../site-rules');
  const rules = parseSiteRules({
    recipes: [quick('grow_wheat'), quick('grow_olives'), quick('mill_flour')],
    sites: config.sites,
  });
  return {
    useRows: (view: string, _columns: string, _order: string, filters: unknown) => {
      state.reads.set(view, filters);
      const rows = view === 'world_events' ? state.events : view === 'my_sites' ? state.sites : [];
      return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
    },
    useSiteRules: () => ({ rules, failed: false, reload: () => Promise.resolve() }),
  };
});
vi.mock('../server-clock', () => ({
  serverClock: { now: () => new Date('2026-06-01T03:30:00Z') },
  syncServerClock: () => Promise.resolve(),
}));
const { SitesCard } = await import('./Sites');

async function show() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
      >
        <SitesCard stock={[]} onChanged={() => Promise.resolve()} />
      </HouseProvider>
    </I18nextProvider>,
  );
}
Element.prototype.scrollIntoView = () => undefined;
const statuses = () =>
  screen
    .queryAllByRole('status')
    .map((region) => region.textContent)
    .filter(Boolean)
    .join(' ');

beforeEach(() => {
  api.collectSite.mockReset();
  window.sessionStorage.clear();
  state.sites = [site('s1', 'grow_wheat')];
  state.events = [];
  state.reads.clear();
});
afterEach(cleanup);

describe('écran Sites : récoltes sous les événements du monde (#417)', () => {
  it('lit les sécheresses et bonnes années des cités des sites, finies après le plus ancien cycle', async () => {
    state.sites = [site('s1', 'grow_wheat'), { ...site('s2', 'grow_olives'), city_id: 'c2' }];
    await show();
    expect(state.reads.get('world_events')).toEqual({
      city_id: ['c1', 'c2'],
      model: ['drought', 'good_year'],
      ends_at: { gt: '2026-06-01T00:00:00.000Z' },
    });
  });

  it('sans site lu ni site du tout, les événements ne sont pas lus', async () => {
    state.sites = [];
    await show();
    expect(state.reads.get('world_events')).toBeNull();
  });

  it('champ à l’arrêt : estimé au rendement de ses cycles gelés, l’événement en cours n’est pas dit', async () => {
    // Arrêté à 2 h : deux cycles faits, avant la sécheresse commencée à 2 h 30 ; rien ne la touche.
    state.sites = [{ ...site('s1', 'grow_wheat'), halted_at: '2026-06-01T02:00:00Z' }];
    state.events = [event('e1', 'drought', '02:30', 5_000)];
    await show();
    expect(await screen.findByText('À récolter : 20 × Blé.')).toBeTruthy();
    expect(screen.queryByText(/^Sécheresse/)).toBeNull();
  });

  it('sécheresse en cours : récolte estimée réduite, l’écart et l’événement dits', async () => {
    // Commencée à 1 h 30 : les cycles finis à 2 h et 3 h rendent ⌊10 × 70 %⌋ = 7, soit 24 au lieu de 30.
    // Une sécheresse d'une autre cité et une bonne année (vergers) ne touchent pas le champ.
    state.events = [
      event('e1', 'drought', '01:30', 3_000),
      event('e2', 'drought', '00:00', 10_000, 'c2'),
      event('e3', 'good_year', '00:00', 5_000),
    ];
    await show();
    expect(
      await screen.findByText('À récolter : 24 × Blé. La sécheresse en retire 6 × Blé.'),
    ).toBeTruthy();
    expect(
      screen.getByText(/^Sécheresse à Kallistè jusqu'au .* rend 30\s?% de moins\.$/),
    ).toBeTruthy();
    expect(screen.queryByText(/^Bonne année/)).toBeNull();
  });

  it('bonne année en cours sur une oliveraie : récolte estimée accrue', async () => {
    state.sites = [site('s2', 'grow_olives')];
    state.events = [event('e3', 'good_year', '00:00', 5_000)];
    await show();
    expect(
      await screen.findByText('À récolter : 45 × Olives. La bonne année y ajoute 15 × Olives.'),
    ).toBeTruthy();
    expect(screen.getByText(/^Bonne année à Kallistè .* rend 50\s?% de plus\.$/)).toBeTruthy();
  });

  it('sécheresse au plus fort : une récolte estimée à zéro est expliquée', async () => {
    state.events = [event('e1', 'drought', '00:00', 10_000)];
    await show();
    expect(await screen.findByText(`À récolter : 0 × Blé. ${fr.home.eventGapZero}`)).toBeTruthy();
  });

  it('une récolte faite réduite, ou réduite à zéro, est expliquée dans l’issue annoncée', async () => {
    state.events = [event('e1', 'drought', '01:30', 3_000)];
    const answer = (quantity: number) => ({
      ok: true,
      replayed: false,
      data: { cycles: 3, outputs: [{ goodId: 'wheat', quantity }] },
    });
    api.collectSite.mockResolvedValueOnce(answer(24)).mockResolvedValueOnce(answer(0));
    await show();
    const button = await screen.findByRole('button', { name: 'Récolter : Champ de blé' });
    fireEvent.click(button);
    await waitFor(() =>
      expect(statuses()).toBe('Récolte engrangée : 24 × Blé. La sécheresse en a retiré 6 × Blé.'),
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(statuses()).toBe(`Récolte engrangée : 0 × Blé. ${fr.home.collectedGapZero}`),
    );
  });

  it('« Tout récolter » nomme les sites dont la récolte a été touchée', async () => {
    state.sites = [site('s1', 'grow_wheat'), site('s2', 'grow_olives')];
    api.collectSite.mockImplementation((siteId: string) =>
      Promise.resolve({
        ok: true,
        replayed: false,
        data:
          siteId === 's1'
            ? { cycles: 3, outputs: [{ goodId: 'wheat', quantity: 0 }] }
            : { cycles: 3, outputs: [{ goodId: 'olives', quantity: 30 }] },
      }),
    );
    await show();
    fireEvent.click(await screen.findByRole('button', { name: /^Tout récolter/ }));
    await waitFor(() =>
      expect(statuses()).toBe(
        'Récolte engrangée sur 2 sites : 0 × Blé et 30 × Olives. ' +
          'La sécheresse a réduit la récolte de : Champ de blé.',
      ),
    );
  });

  it('événements illisibles : la récolte d’un champ n’est pas estimée, relire est proposé', async () => {
    state.events = null;
    await show();
    await screen.findByRole('button', { name: 'Récolter : Champ de blé' });
    expect(screen.queryByText(/^À récolter/)).toBeNull();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });
});

const answer = (cycles: number, goodId: string, quantity: number) => ({
  ok: true,
  replayed: false,
  data: { cycles, outputs: [{ goodId, quantity }] },
});
const collectAllButton = () => screen.findByRole('button', { name: /^Tout récolter/ });

describe('écran Sites : issue d’une récolte faite (#417, #456)', () => {
  it('un atelier et un champ sans écart : rien n’est dit après la quantité', async () => {
    state.sites = [site('s1', 'grow_wheat'), site('s3', 'mill_flour')];
    api.collectSite
      .mockResolvedValueOnce(answer(3, 'wheat', 30))
      .mockResolvedValueOnce(answer(3, 'flour', 30));
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Récolter : Champ de blé' }));
    await waitFor(() => expect(statuses()).toBe('Récolte engrangée : 30 × Blé.'));
    fireEvent.click(screen.getByRole('button', { name: 'Récolter : Moulin' }));
    await waitFor(() => expect(statuses()).toBe('Récolte engrangée : 30 × Farine.'));
  });

  it('bonne année : la récolte faite accrue est dite, et « Tout récolter » nomme le verger', async () => {
    state.sites = [site('s1', 'grow_wheat'), site('s2', 'grow_olives')];
    api.collectSite.mockResolvedValueOnce(answer(3, 'olives', 45));
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Récolter : Oliveraie' }));
    await waitFor(() =>
      expect(statuses()).toBe(
        'Récolte engrangée : 45 × Olives. La bonne année y a ajouté 15 × Olives.',
      ),
    );
    api.collectSite.mockImplementation((siteId: string) =>
      Promise.resolve(siteId === 's1' ? answer(3, 'wheat', 30) : answer(3, 'olives', 45)),
    );
    fireEvent.click(await collectAllButton());
    await waitFor(() =>
      expect(statuses()).toBe(
        'Récolte engrangée sur 2 sites : 30 × Blé et 45 × Olives. ' +
          'La bonne année a accru la récolte de : Oliveraie.',
      ),
    );
  });

  it('écart d’un signe contraire au modèle (extrant changé par une version) : rien n’est dit', async () => {
    state.sites = [site('s1', 'grow_wheat'), site('s2', 'grow_olives')];
    // Un champ qui rend plus, un verger qui rend moins, que `cycles` × extrant affiché.
    api.collectSite.mockImplementation((siteId: string) =>
      Promise.resolve(siteId === 's1' ? answer(3, 'wheat', 36) : answer(3, 'olives', 0)),
    );
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Récolter : Champ de blé' }));
    await waitFor(() => expect(statuses()).toBe('Récolte engrangée : 36 × Blé.'));
    fireEvent.click(screen.getByRole('button', { name: 'Récolter : Oliveraie' }));
    await waitFor(() => expect(statuses()).toBe('Récolte engrangée : 0 × Olives.'));
    fireEvent.click(await collectAllButton());
    await waitFor(() =>
      expect(statuses()).toBe('Récolte engrangée sur 2 sites : 36 × Blé et 0 × Olives.'),
    );
  });

  it('« Tout récolter » entièrement réduit à zéro : dit « à rien », comme une récolte seule', async () => {
    state.sites = [site('s1', 'grow_wheat'), site('s4', 'grow_wheat')];
    api.collectSite.mockResolvedValue(answer(3, 'wheat', 0));
    await show();
    fireEvent.click(await collectAllButton());
    await waitFor(() =>
      expect(statuses()).toBe(
        'Récolte engrangée sur 2 sites : 0 × Blé. La sécheresse a réduit à rien la récolte de : ' +
          'Champ de blé 1 et Champ de blé 2 ; les cycles sont comptés, sans rien produire.',
      ),
    );
  });

  it('« Tout récolter » réessayé après un échec : seule l’issue du nouvel essai est dite', async () => {
    state.sites = [site('s1', 'grow_wheat'), site('s2', 'grow_olives')];
    api.collectSite
      .mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: '' } })
      .mockResolvedValueOnce(answer(3, 'olives', 45))
      .mockResolvedValueOnce(answer(3, 'wheat', 0))
      .mockResolvedValueOnce(answer(3, 'olives', 30));
    await show();
    fireEvent.click(await collectAllButton());
    await waitFor(() =>
      expect(statuses()).toBe(
        'Récolte engrangée sur 1 site : 45 × Olives. ' +
          'La bonne année a accru la récolte de : Oliveraie. ' +
          `Échec pour Champ de blé. ${fr.errors.INTERNAL}`,
      ),
    );
    fireEvent.click(await collectAllButton());
    await waitFor(() =>
      expect(statuses()).toBe(
        'Récolte engrangée sur 2 sites : 0 × Blé et 30 × Olives. ' +
          'La sécheresse a réduit la récolte de : Champ de blé.',
      ),
    );
  });
});

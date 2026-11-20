import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Lectures simulées, par vue : l'entrepôt de Kallistè et les voyages du test.
const views = vi.hoisted(() => ({ rows: {} as Record<string, object[]> }));
vi.mock('../data', () => ({
  useRows: (view: string) => ({
    rows: views.rows[view] ?? [],
    failed: false,
    reload: () => Promise.resolve(null),
  }),
  useClockRules: () => ({ rules: null, failed: false, reload: () => Promise.resolve() }),
}));
vi.mock('./Sites', () => ({ SitesCard: () => null }));
// Liens sans routeur : de simples ancres.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouterState: () => '/',
}));
const { HomeScreen } = await import('./Home');

const WHEAT = [{ id: 'i1', city_id: 'k', good_id: 'wheat', quantity: 70, reserved: 0 }];
async function render(voyages: object[], inventories: object[] = WHEAT) {
  views.rows = {
    my_treasury: [{ balance: 600 }],
    my_inventories: inventories,
    my_voyages: voyages,
  };
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'k', accessToken: 't', cityName: 'Kallistè' };
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { k: 'Kallistè', e: 'Elaia' }, citizenshipStatus: 'metic' }}
      >
        <HomeScreen />
      </HouseProvider>
    </I18nextProvider>,
  );
}

describe('entrepôt : le stock par cité, celui en mer compris', () => {
  it('une cargaison en mer est listée sous sa cité d’arrivée, à part du stock à quai', async () => {
    const html = await render([
      { id: 'v1', to_city_id: 'e', arrived_at: null, cargo: [{ goodId: 'wheat', quantity: 30 }] },
    ]);
    expect(html).toContain('Stock à Kallistè');
    expect(html).toContain('En mer, vers Elaia');
    expect(html).toContain('Blé : 30');
  });

  it('un voyage arrivé ou parti sur lest n’ajoute rien : sa cargaison est à quai, ou il n’en a pas', async () => {
    const html = await render([
      { id: 'v1', to_city_id: 'e', arrived_at: '2026-11-16T00:00:00Z', cargo: [] },
      { id: 'v2', to_city_id: 'e', arrived_at: null, cargo: [] },
    ]);
    expect(html).not.toContain('En mer');
    // Une seule cité : pas de titre par cité.
    expect(html).not.toContain('Stock à Kallistè');
  });

  it('vide : la raison, et le lien qui mène à l’agora pour le remplir (#866)', async () => {
    const html = await render([], []);
    expect(html).toContain(`>${fr.home.stockEmpty.replace("'", '&#x27;')}</h3>`);
    expect(html).toContain(`<a href="/agora">${fr.home.stockAction.replace("'", '&#x27;')}</a>`);
  });
});

describe('finitions (#869)', () => {
  it('sous 1 024 px, le titre ne répète pas le nom de la maison ; son nom accessible reste entier', async () => {
    const html = await render([]);
    const title = /<h1[^>]*>(.*?)<\/h1>/.exec(html)?.[1] ?? '';
    // Ce que lit un lecteur d'écran : tout sauf ce qui est caché aux technologies d'assistance.
    expect(
      title.replace(/<span aria-hidden="true"[^>]*>.*?<\/span>/g, '').replace(/<[^>]+>/g, ''),
    ).toBe('Bonjour, Maison Test');
    expect(title).toMatch(/<span aria-hidden="true" class="lg:hidden">Bonjour<\/span>/);
    expect(title).toMatch(/<span class="max-lg:sr-only">Bonjour, Maison Test<\/span>/);
  });

  it('les titres de section de l’écran portent tous une icône', async () => {
    const html = await render([]);
    const titles = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((match) => match[1] ?? '');
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.filter((title) => !title.includes('<svg'))).toEqual([]);
  });
});

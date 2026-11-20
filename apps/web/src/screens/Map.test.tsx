import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

const CITIES = { k: 'kalliste', e: 'elaia', a: 'ampelos', h: 'halos' };
const NAMES = { k: 'Kallistè', e: 'Elaia', a: 'Ampélos', h: 'Halos' };
// Lectures simulées, par vue ; les règles du transport sont celles de la configuration initiale.
const views = vi.hoisted(() => ({
  rows: {} as Record<string, object[] | null>,
  rules: undefined as unknown,
}));
vi.mock('../data', async () => {
  const { parseShipRules } = await import('../ship-rules');
  const { INITIAL_CONFIG } = await import('@oikos/config');
  const rules = parseShipRules({ ships: (INITIAL_CONFIG as GameConfig).ships });
  const reload = () => Promise.resolve(null);
  return {
    useRows: (view: string) => ({ rows: views.rows[view] ?? null, failed: false, reload }),
    useShipRules: () => ({ rules: views.rules ?? rules, failed: false, reload }),
    useClockRules: () => ({ rules: null, failed: false, reload }),
    useSiteRules: () => ({ rules: null, failed: false, reload }),
  };
});
// Liens sans routeur : de simples ancres.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => () => Promise.resolve(),
}));
const { MapScreen } = await import('./Map');
const { formatMoney } = await import('../money');
const { parseShipRules } = await import('../ship-rules');

async function render(ships: object[] | null, voyages: object[] = [], rates?: object[]) {
  views.rows = {
    my_ships: ships,
    my_voyages: voyages,
    ...(rates && { city_rates: rates }),
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
        value={{ ...house, cityNames: NAMES, citySlugs: CITIES, citizenshipStatus: 'metic' }}
      >
        <MapScreen />
      </HouseProvider>
    </I18nextProvider>,
  );
}

/** Le dessin seul, sans les icônes des boutons de zoom qui le suivent. */
const drawing = (html: string) =>
  html.slice(html.indexOf('role="img"'), html.indexOf(`aria-label="${fr.map.zoomIn}"`));

describe('carte de l’archipel', () => {
  it('quatre cités et six routes dessinées, et la liste qui les dit au clavier', async () => {
    const html = await render([]);
    expect(html).toContain('role="img" aria-label="Carte de l&#x27;archipel : 4 cités, 6 routes');
    expect(drawing(html).match(/<line /g)).toHaveLength(6);
    expect(html).toContain('Kallistè – Elaia : 4 h');
    expect(html).toContain('Elaia – Halos : 8 h');
    expect(html).toContain('pas encore de navire');
  });

  it('sans navire : l’état vide mène au chantier naval, titre qui prend le foyer (#866)', async () => {
    const html = await render([]);
    expect(html).toContain(`>${fr.map.toShipyard}</button>`);
    expect(html).toMatch(/<h2 id="shipyard" tabindex="-1"[^>]*>.*Chantier naval/);
    expect(await render([{ id: 's1', class_id: 'coaster', docked_city_id: 'k' }])).not.toContain(
      fr.map.toShipyard,
    );
  });

  it('chaque navire dit où il est : à quai, ou en mer avec sa destination', async () => {
    const html = await render(
      [
        { id: 's1', class_id: 'coaster', docked_city_id: 'k', laid_up_at: null },
        { id: 's2', class_id: 'coaster', docked_city_id: null, laid_up_at: null },
        {
          id: 's3',
          class_id: 'round_ship',
          docked_city_id: 'e',
          laid_up_at: '2026-11-16T03:00:00Z',
        },
      ],
      [
        {
          id: 'v1',
          ship_id: 's2',
          from_city_id: 'k',
          to_city_id: 'h',
          departed_at: '2026-11-16T10:00:00Z',
          arrives_at: '2026-11-16T16:00:00Z',
          arrived_at: null,
          cargo: [],
        },
      ],
    );
    expect(html).toContain('Caboteur n° 1</a> : à quai à Kallistè');
    expect(html).toContain('Caboteur n° 2</a> : en mer vers Halos, arrivée prévue le');
    expect(html).toContain('Navire rond</a> : à quai à Elaia (désarmé');
    // Un navire en mer est dessiné sur sa route, en plus des quatre cités.
    expect(drawing(html).match(/<circle /g)).toHaveLength(5);
    // À côté de la carte, le voyage en cours : sa route, sa cargaison, la part du trajet faite.
    expect(html).toContain('Vos navires en mer');
    expect(html).toContain('Kallistè → Halos · sur lest, sans cargaison');
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="100"/);
    // La route du navire en mer est mise en avant, les cinq autres non.
    expect(drawing(html).match(/<line [^>]*class="stroke-primary"/g)).toHaveLength(1);
    expect(drawing(html).match(/<line [^>]*class="stroke-route"/g)).toHaveLength(5);
  });

  it('chantier : chaque classe à son prix de la configuration, en drachmes ; rien avant la flotte', async () => {
    const instance = i18next.createInstance();
    await instance.init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    const html = await render([]);
    for (const shipClass of (INITIAL_CONFIG as GameConfig).ships.classes)
      expect(html).toContain(
        `Acheter — ${formatMoney(shipClass.purchaseCostOboles, instance.t, 'fr')}</button>`,
      );
    const before = await render(null);
    // Le libellé suit l'icône décorative du bouton (#869).
    expect(before).toMatch(
      /<button[^>]*disabled=""[^>]*>(<svg[^>]*aria-hidden="true".*?<\/svg>)?Acheter — /,
    );
  });

  it('« Faire partir un navire » à droite de l’en-tête, dès qu’un navire armé est à quai', async () => {
    // L'en-tête : de son titre à la carte qui le suit.
    const header = (html: string) => html.slice(html.indexOf('<h1'), html.indexOf('role="img"'));
    const action = (html: string) => header(html).slice(header(html).indexOf('page-header-action'));
    const atSea = { id: 's2', class_id: 'coaster', docked_city_id: null, laid_up_at: null };
    const laidUp = {
      id: 's3',
      class_id: 'round_ship',
      docked_city_id: 'e',
      laid_up_at: '2026-11-16',
    };
    const docked = { id: 's1', class_id: 'coaster', docked_city_id: 'k', laid_up_at: null };
    const ready = await render([atSea, laidUp, docked], [], []);
    expect(action(ready)).toContain(`${fr.map.depart}</button>`);
    expect(action(ready)).toContain(fr.map.layer.terroirs);
    expect(ready.match(new RegExp(fr.map.depart, 'g'))).toHaveLength(1);
    // Ni navire en mer ni navire désarmé ne partent ; droits de port pas encore lus : pas d'action non plus.
    expect(await render([atSea, laidUp], [], [])).not.toContain(fr.map.depart);
    expect(await render([docked])).not.toContain(fr.map.depart);
  });

  it('une cité qu’aucune route ne relie est nommée dans la liste', async () => {
    const config = INITIAL_CONFIG as GameConfig;
    const halos = config.ships.routes.filter(({ cities }) => !cities.includes('halos'));
    views.rules = parseShipRules({ ships: { ...config.ships, routes: halos } });
    const html = await render([]);
    views.rules = undefined;
    expect(html).toContain('Sans route : Halos.');
  });
});

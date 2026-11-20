import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import fr from '../locales/fr.json';

const views = vi.hoisted(() => ({
  rows: {} as Record<string, object[] | null>,
  filters: {} as Record<string, unknown>,
}));
vi.mock('../data', () => ({
  useRows: (view: string, _columns: string, _order: string, filters: unknown) => {
    views.filters[view] = filters;
    return { rows: views.rows[view] ?? null, failed: false, reload: () => Promise.resolve(null) };
  },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { search: { cite: string }; children: React.ReactNode }) => (
    <a href={`/agora?cite=${props.search.cite}`}>{props.children}</a>
  ),
}));
const { CityPanel } = await import('./CityPanel');

async function render() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const names: Record<string, string> = { k: 'Kallistè', e: 'Elaia' };
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <CityPanel
        cityIds={['e', 'k']}
        cityId="e"
        onChange={() => undefined}
        cityName={(id) => names[id] ?? id}
        homeId="k"
        identity={{
          slug: 'elaia',
          terroir: ['grow_olives', 'rake_salt'],
          hasPort: true,
          patronGodId: 'athena',
          startingRecipeId: 'grow_wheat',
        }}
      />
    </I18nextProvider>,
  );
}

describe('panneau de la cité choisie sur la carte', () => {
  it('population, taxe en vigueur, les trois cours les plus échangés, terroir, lien vers son agora', async () => {
    views.rows = {
      city_population: [
        { class_id: 'thetes', population: 6000, coverage_bps: null },
        { class_id: 'hippeis', population: 1200, coverage_bps: null },
      ],
      city_rates: [{ market_tax_rate_bps: 250 }],
      observed_prices: [
        { good_id: 'salt', price: 3, volume: 5 },
        { good_id: 'olives', price: 7, volume: 40 },
        { good_id: 'wheat', price: 13, volume: 12 },
        { good_id: 'wine', price: 30, volume: 20 },
      ],
      my_inventories: [{ city_id: 'k' }, { city_id: 'e' }],
      my_sites: [],
    };
    const html = (await render()).replace(/[\u202f\u00a0]/g, ' ');
    for (const view of ['city_population', 'city_rates', 'observed_prices'])
      expect(views.filters[view]).toEqual({ city_id: 'e' });
    // Titre de section, son icône décorative devant le nom (#869).
    expect(html).toMatch(/<h2[^>]*><span aria-hidden="true">.*?<\/span>Elaia<\/h2>/);
    expect(html).toMatch(/Population<\/dt><dd[^>]*>7 200</);
    expect(html).toMatch(/Taxe de marché<\/dt><dd[^>]*>2,5 %</);
    expect(html.match(/, l&#x27;unité/g)).toHaveLength(3);
    expect(html).toMatch(/Olives, l&#x27;unité<\/dt><dd[^>]*>1 drachme 1 obole</);
    expect(html).not.toContain('Sel, l');
    expect(html).toContain('Terroir : Oliveraie et Saline');
    expect(html).toContain('href="/agora?cite=e"');
    expect(html).toContain('Ouvrir l&#x27;agora — Elaia');
  });

  it('rien encore lu : des tirets, jamais un chiffre inventé', async () => {
    views.rows = {};
    const html = await render();
    // La taxe en tiret ; la population inconnue dite par un texte, jamais « Population — » (#869).
    expect(html.match(/<dd[^>]*>—<\/dd>/g)).toHaveLength(1);
    expect(html).toContain(`>${fr.map.city.populationUnknown}</dd>`);
    expect(html).not.toContain(fr.map.city.noPrices);
  });

  it('une cité où la maison n’a ni stock ni site : le lien mène à l’agora de la maison, et le dit', async () => {
    views.rows = { my_inventories: [{ city_id: 'k' }], my_sites: [] };
    const html = await render();
    expect(html).toContain('Elaia n&#x27;est pas proposée à l&#x27;agora');
    expect(html).toContain('href="/agora?cite=k"');
    expect(html).toContain('Ouvrir l&#x27;agora — Kallistè');
  });
});

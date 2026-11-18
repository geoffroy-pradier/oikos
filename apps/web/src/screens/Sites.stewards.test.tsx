import { INITIAL_CONFIG } from '@oikos/config';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Lectures simulées vue par vue : deux sites, l'intendant du moulin et sa règle (#278).
const views = vi.hoisted(() => ({ rows: {} as Record<string, object[] | null> }));
vi.mock('../data', async () => {
  const { parseSiteRules } = await import('../site-rules');
  const config = INITIAL_CONFIG as { sites: object; recipes: unknown };
  const stewards = { limitByHeadquartersLevel: [2], dailyWageOboles: 8, rulesPerSteward: 3 };
  const rules = parseSiteRules({ recipes: config.recipes, sites: { ...config.sites, stewards } });
  const reload = () => Promise.resolve(null);
  return {
    useRows: (view: string) => ({
      rows: view in views.rows ? views.rows[view] : [],
      failed: false,
      reload,
    }),
    useSiteRules: () => ({ rules, failed: false, reload }),
  };
});
const { SitesCard } = await import('./Sites');

const site = (id: string, recipe_id: string) => ({
  id,
  city_id: 'c1',
  recipe_id,
  cycle_started_at: '2026-11-01T00:00:00Z',
  halted_at: null,
});
async function render() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
        <SitesCard stock={[]} onChanged={() => Promise.resolve()} />
      </HouseProvider>
    </I18nextProvider>,
  );
}

describe('fiche de site : section Intendant (#278)', () => {
  it('chaque site a sa section, l’intendant et ses règles sur le sien, l’embauche ailleurs', async () => {
    const hired = '2026-11-17T10:00:00.000Z';
    views.rows = {
      my_sites: [site('s1', 'grow_wheat'), site('s2', 'mill_flour')],
      my_stewards: [
        {
          id: 'st1',
          site_id: 's2',
          name: 'Nikias',
          hired_at: hired,
          unpaid_since: null,
          rules_revision: 1,
        },
      ],
      my_steward_rules: [
        {
          steward_id: 'st1',
          position: 0,
          kind: 'buy',
          good_id: 'wheat',
          price_oboles: '7',
          units: '50',
        },
      ],
    };
    const html = await render();
    expect(html.match(/<h4[^>]*>Intendant<\/h4>/g)).toHaveLength(2);
    expect(html).toContain('Nikias mène ses règles');
    expect(html).toContain('aria-label="Règles de Nikias"');
    expect(html).toContain('value="50"');
    // Un poste reste libre : le champ de blé peut embaucher.
    expect(html).toContain('aria-label="Embaucher un intendant pour Champ de blé"');
  });

  it('sans les intendants lus, aucune section : rien n’est proposé sur une lecture incomplète', async () => {
    views.rows = { my_sites: [site('s1', 'grow_wheat')], my_stewards: null };
    expect(await render()).not.toContain('<h4');
  });
});

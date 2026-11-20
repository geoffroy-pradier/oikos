import { INITIAL_CONFIG } from '@oikos/config';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Lectures simulées : les règles sont toujours lues, l'état des sites est celui du test.
const sites = vi.hoisted(() => ({ rows: null as object[] | null, failed: false }));
vi.mock('../data', async () => {
  const { parseSiteRules } = await import('../site-rules');
  const rules = parseSiteRules(INITIAL_CONFIG);
  const reload = () => Promise.resolve();
  return {
    useRows: () => ({ ...sites, reload }),
    useSiteRules: () => ({ rules, failed: false, reload }),
  };
});
const { SitesCard } = await import('./Sites');

const field = {
  id: 's1',
  city_id: 'c1',
  recipe_id: 'grow_wheat',
  cycle_started_at: '2026-01-01T00:00:00Z',
};
async function render(rows: object[] | null, failed = false) {
  Object.assign(sites, { rows, failed });
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
const SUBMIT = `${fr.home.acquire}</button>`;

describe('acquisition proposée seulement quand les sites sont lus', () => {
  it('règles lues avant les sites : pas de formulaire, la lecture est annoncée', async () => {
    const html = await render(null);
    expect(html).not.toContain('<form');
    expect(html).not.toContain(SUBMIT);
    expect(html).toContain(fr.app.loading);
  });

  it('lecture des sites en échec : pas de formulaire, relire est proposé', async () => {
    const html = await render(null, true);
    expect(html).not.toContain(SUBMIT);
    expect(html).toContain(`>${fr.app.retry}</button>`);
  });

  it('sites lus, même aucun : « Acquérir un site » est proposé et actif', async () => {
    for (const rows of [[], [{ ...field, halted_at: null }]]) {
      const html = await render(rows);
      const trigger = html.slice(
        html.lastIndexOf('<button', html.indexOf(SUBMIT)),
        html.indexOf(SUBMIT),
      );
      expect(trigger).toContain('aria-disabled="false"');
      expect(trigger).not.toContain('disabled=""');
    }
  });
});

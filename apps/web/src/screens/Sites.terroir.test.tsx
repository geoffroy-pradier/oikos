import { INITIAL_CONFIG, validateConfig } from '@oikos/config';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

// Lectures simulées : les règles de la configuration initiale, et pour chaque vue les lignes du test.
const read = vi.hoisted(() => ({ sites: [] as object[], identities: null as unknown }));
vi.mock('../data', async () => {
  const { parseSiteRules } = await import('../site-rules');
  const rules = parseSiteRules(INITIAL_CONFIG);
  const reload = () => Promise.resolve();
  return {
    useRows: (view: string) => ({
      rows: view === 'city_identity' ? read.identities : read.sites,
      failed: false,
      reload,
    }),
    useSiteRules: () => ({ rules, failed: false, reload }),
  };
});
const { SitesCard } = await import('./Sites');

/** Identité lue de la vue `city_identity` : Ampelos (c1) et Halos (c2), terroirs de la configuration. */
const identity = (cityId: string, terroir: string[] | null) => ({
  city_id: cityId,
  terroir,
  has_port: true,
  patron_god_id: null,
  starting_recipe_id: terroir?.[0] ?? 'grow_wheat',
});
const AMPELOS = ['grow_grapes', 'catch_fish', 'shear_wool', 'dig_clay'];
const HALOS = ['catch_fish', 'rake_salt', 'dig_clay', 'fell_wood', 'shear_wool'];
const site = (id: string, cityId: string, recipeId: string) => ({
  id,
  city_id: cityId,
  recipe_id: recipeId,
  cycle_started_at: '2026-01-01T00:00:00Z',
  halted_at: null,
});

async function render(sites: object[], identities: unknown, lng: 'fr' | 'en' = 'fr') {
  Object.assign(read, { sites, identities });
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Ampelos' };
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
        <SitesCard stock={[]} onChanged={() => Promise.resolve()} />
      </HouseProvider>
    </I18nextProvider>,
  );
}
/** Valeurs des options d'un menu, repéré par ce qui précède son premier `<option>`. */
const optionsAfter = (html: string, marker: string) => {
  const start = html.indexOf(marker);
  const end = html.indexOf('</select>', start);
  return [...html.slice(start, end).matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
};
const ACQUIRE = `<span>${fr.home.acquireRecipe}</span>`;
// Le rendu échappe l'apostrophe : on cherche la mention par son texte tel qu'il paraît dans le HTML.
const OUT_OF_TERROIR = fr.home.outOfTerroir.replaceAll("'", '&#x27;');
const validated = validateConfig(INITIAL_CONFIG);
if (!validated.ok) throw new Error(validated.errors.join('\n'));
const RECIPES = validated.config.recipes;
const WORKSHOPS = RECIPES.filter((recipe) => recipe.siteType === 'workshop').map(
  (recipe) => recipe.id,
);

describe('écran Sites : seules les productions du terroir sont proposées (6.1, #291)', () => {
  it('acquisition : les matières premières du terroir de la cité, et tous les ateliers', async () => {
    const html = await render([], [identity('c1', AMPELOS), identity('c2', HALOS)]);
    const offered = optionsAfter(html, ACQUIRE);
    expect(offered).toEqual(
      RECIPES.map((recipe) => recipe.id).filter(
        (id) => AMPELOS.includes(id) || WORKSHOPS.includes(id),
      ),
    );
    // Le choix par défaut est admis : le premier essai d'un joueur d'Ampelos n'échoue plus sur le blé.
    expect(offered[0]).toBe('grow_grapes');
    expect(offered).not.toContain('grow_wheat');
  });

  it('changement de production : seulement vers une recette admise par la cité du site', async () => {
    const fishery = (cityId: string) => site(`s-${cityId}`, cityId, 'catch_fish');
    // Halos admet le sel : la pêcherie peut passer au sel. Ampelos non : aucun changement proposé.
    const halos = await render([fishery('c2')], [identity('c1', AMPELOS), identity('c2', HALOS)]);
    expect(optionsAfter(halos, `<span>${fr.home.production}</span>`)).toEqual([
      'catch_fish',
      'rake_salt',
    ]);
    const ampelos = await render([fishery('c1')], [identity('c1', AMPELOS), identity('c2', HALOS)]);
    expect(ampelos).not.toContain(`<span>${fr.home.production}</span>`);
  });

  it('un site hors terroir garde sa recette et le dit ; un site du terroir ne dit rien', async () => {
    const html = await render(
      [site('s1', 'c1', 'grow_wheat'), site('s2', 'c1', 'grow_grapes')],
      [identity('c1', AMPELOS)],
    );
    expect(html.split(OUT_OF_TERROIR)).toHaveLength(2);
    // En anglais, le terroir se dit « land », comme partout ailleurs dans l'interface.
    const english = await render([site('s1', 'c1', 'grow_wheat')], [identity('c1', AMPELOS)], 'en');
    expect(english).toContain(en.home.outOfTerroir.replaceAll("'", '&#x27;'));
    expect(english).toContain(`<span>${en.home.acquireRecipe}</span>`);
  });

  it('identité illisible, absente ou terroir ouvert : tout est proposé, l’API tranche', async () => {
    const all = RECIPES.map((recipe) => recipe.id);
    for (const identities of [null, [{ city_id: 7 }], [], [identity('c1', null)]]) {
      const html = await render([site('s1', 'c1', 'grow_wheat')], identities);
      expect(optionsAfter(html, ACQUIRE)).toEqual(all);
      expect(html).not.toContain(OUT_OF_TERROIR);
    }
  });
});

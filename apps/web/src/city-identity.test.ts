import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { describeCity, parseCityIdentities } from './city-identity';
import en from './locales/en.json';
import fr from './locales/fr.json';

const row = (patch: Record<string, unknown> = {}) => ({
  city_id: 'c-1',
  terroir: ['grow_grapes', 'catch_fish'],
  has_port: true,
  patron_god_id: 'dionysos',
  starting_recipe_id: 'grow_grapes',
  ...patch,
});
const translator = async (lng: 'fr' | 'en') => {
  const instance = i18next.createInstance();
  await instance.init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    interpolation: { escapeValue: false },
  });
  return instance.t;
};

describe('identité des cités', () => {
  it('lit chaque cité par son identifiant ; champs nuls d’une version antérieure : valeurs par défaut', () => {
    const identities = parseCityIdentities([
      row(),
      row({ city_id: 'c-2', terroir: null, has_port: null, patron_god_id: null }),
    ]);
    expect(identities?.get('c-1')).toEqual({
      terroir: ['grow_grapes', 'catch_fish'],
      hasPort: true,
      patronGodId: 'dionysos',
      startingRecipeId: 'grow_grapes',
    });
    // Terroir ouvert, port, aucun dieu : comme l'API lit une version publiée avant les quatre cités.
    expect(identities?.get('c-2')).toEqual({
      terroir: null,
      hasPort: true,
      patronGodId: null,
      startingRecipeId: 'grow_grapes',
    });
    expect(parseCityIdentities([row({ has_port: false })])?.get('c-1')?.hasPort).toBe(false);
  });

  it('une ligne illisible fait échouer la lecture, jamais une identité inventée', () => {
    for (const bad of [
      row({ terroir: 'grow_grapes' }),
      row({ has_port: 'yes' }),
      row({ starting_recipe_id: null }),
      row({ city_id: undefined }),
    ])
      expect(parseCityIdentities([row({ city_id: 'c-2' }), bad])).toBeNull();
    expect(parseCityIdentities(null)).toBeNull();
    expect(parseCityIdentities([])).toEqual(new Map());
  });

  it('décrit dieu, port, terroir et premier site, en français et en anglais', async () => {
    const identity = parseCityIdentities([row()])?.get('c-1');
    if (!identity) throw new Error('identity missing');
    expect(describeCity(identity, await translator('fr'), 'fr')).toEqual({
      god: 'Protégée par Dionysos',
      port: 'Cité portuaire',
      terroir: 'Terroir : Vigne et Pêcherie',
      start: 'Premier site : Vigne',
    });
    expect(describeCity(identity, await translator('en'), 'en')).toEqual({
      god: 'Protected by Dionysus',
      port: 'Port city',
      terroir: 'Land: Vineyard and Fishery',
      start: 'First site: Vineyard',
    });
  });

  it('sans dieu, sans port, terroir ouvert ; identifiant sans traduction affiché tel quel', async () => {
    const t = await translator('fr');
    expect(
      describeCity(
        { terroir: null, hasPort: false, patronGodId: null, startingRecipeId: 'grow_barley' },
        t,
        'fr',
      ),
    ).toEqual({
      god: 'Sans dieu protecteur',
      port: 'Sans port',
      terroir: 'Terroir : toutes les productions',
      start: 'Premier site : grow_barley',
    });
  });
});

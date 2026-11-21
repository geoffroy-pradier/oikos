import i18next from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import en from './locales/en.json';
import fr from './locales/fr.json';

// Aucune lecture : seule l'annonce est éprouvée ici.
vi.mock('./data', () => ({ useRows: () => null, useShipRules: () => null }));
const { arrivalKey } = await import('./fleet');

// Annonce d'une arrivée (#730) : une cargaison perdue en mer n'est jamais dite déchargée, en français et en anglais.
// En test, les espaces insécables du français sont ordinaires (`vitest.config.ts`).
describe('annonce d’une arrivée', () => {
  it('déchargée, ou perdue en mer ; en mer, l’issue nulle n’est pas une perte', async () => {
    const instance = i18next.createInstance();
    await instance.init({
      resources: { fr: { translation: fr }, en: { translation: en } },
      interpolation: { escapeValue: false },
    });
    const say = (lng: 'fr' | 'en', scope: 'map' | 'ship', cargoLost: boolean | null) =>
      instance.t(arrivalKey(scope, { cargo_lost: cargoLost }), {
        lng,
        city: 'Elaia',
        cargo: lng === 'fr' ? '30 × Blé' : '30 × Wheat',
      });
    expect(say('fr', 'map', true)).toBe(
      'Un navire est arrivé à vide à Elaia : sa cargaison a été perdue en mer.',
    );
    expect(say('en', 'map', true)).toBe(
      'A ship arrived empty at Elaia: its cargo was lost at sea.',
    );
    expect(say('fr', 'ship', true)).toBe('Navire arrivé à vide à Elaia : 30 × Blé, perdue en mer.');
    expect(say('en', 'ship', true)).toBe('Ship arrived empty at Elaia: 30 × Wheat, lost at sea.');
    for (const lng of ['fr', 'en'] as const)
      for (const scope of ['map', 'ship'] as const)
        for (const cargoLost of [false, null]) {
          expect(arrivalKey(scope, { cargo_lost: cargoLost })).toBe(`${scope}.arrived`);
          expect(say(lng, scope, cargoLost)).not.toMatch(/perdue|lost/);
        }
    expect(say('en', 'ship', false)).toBe(
      'Ship arrived at Elaia: 30 × Wheat, unloaded into your stock.',
    );
  });
});

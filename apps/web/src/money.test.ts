import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { formatOboles } from './money';
import en from './locales/en.json';
import fr from './locales/fr.json';

async function translator(language: 'fr' | 'en') {
  const instance = i18next.createInstance();
  await instance.init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng: language,
    interpolation: { escapeValue: false },
  });
  return instance.t;
}

describe('montants en oboles', () => {
  it('accorde l’unité au nombre en français : zéro et un au singulier', async () => {
    const t = await translator('fr');
    expect(formatOboles(t, 'fr', 0)).toBe('0 obole');
    expect(formatOboles(t, 'fr', 1)).toBe('1 obole');
    expect(formatOboles(t, 'fr', 2)).toBe('2 oboles');
    expect(formatOboles(t, 'fr', 3000)).toBe(`${new Intl.NumberFormat('fr').format(3000)} oboles`);
  });

  it('accorde l’unité au nombre en anglais : un seul singulier', async () => {
    const t = await translator('en');
    expect(formatOboles(t, 'en', 0)).toBe('0 obols');
    expect(formatOboles(t, 'en', 1)).toBe('1 obol');
    expect(formatOboles(t, 'en', 1500)).toBe('1,500 obols');
  });

  it('les textes qui reçoivent un montant ne répètent pas l’unité', async () => {
    const t = await translator('fr');
    const text = t('agora.placedBuy', {
      quantity: '1',
      good: 'Blé',
      price: formatOboles(t, 'fr', 1),
      held: formatOboles(t, 'fr', 1),
    });
    expect(text).toBe(
      "Achat en attente : 1 × Blé à 1 obole. Le séquestre retient 1 obole jusqu'à l'exécution ou l'annulation.",
    );
  });
});
